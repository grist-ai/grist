import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { createGateway } from "../../src/grist/gateway/http"

const opencodeRoot = path.resolve(import.meta.dir, "../..")
const cli = path.join(opencodeRoot, "src/index.ts")
const modelsPath = path.join(opencodeRoot, "test/tool/fixtures/models-api.json")
const homes: string[] = []
const procs: Array<{ kill: () => void }> = []

afterEach(() => {
  for (const proc of procs.splice(0)) proc.kill()
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true })
})

function isolatedEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  fs.mkdirSync(path.join(home, ".config"), { recursive: true })
  fs.mkdirSync(path.join(home, ".local/share"), { recursive: true })
  fs.mkdirSync(path.join(home, ".local/state"), { recursive: true })
  fs.mkdirSync(path.join(home, ".cache"), { recursive: true })
  fs.mkdirSync(path.join(home, ".grist"), { recursive: true })
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value
  }
  delete env.OPENAI_API_KEY
  delete env.ANTHROPIC_API_KEY
  delete env.OPENROUTER_API_KEY
  delete env.OPENCODE_AUTH_CONTENT
  delete env.OPENCODE_CONFIG_CONTENT
  return {
    ...env,
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_STATE_HOME: path.join(home, ".local/state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_MODELS_PATH: modelsPath,
    GRIST_CONFIG_PATH: path.join(home, ".grist", "config.json"),
    ...extra,
  }
}

async function runCli(args: string[], env: Record<string, string>, cwd = opencodeRoot) {
  const proc = Bun.spawn(["bun", "run", cli, ...args], {
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode, text: `${stdout}\n${stderr}` }
}

async function startHtmlServer() {
  const port = 21000 + Math.floor(Math.random() * 1000)
  const proc = Bun.spawn(
    [
      "bun",
      "-e",
      `Bun.serve({ port: ${port}, fetch() { return new Response("<!doctype html><title>nope</title>", { headers: { "Content-Type": "text/html" } }) } })`,
    ],
    { stdout: "ignore", stderr: "ignore" },
  )
  procs.push({ kill: () => proc.kill() })
  for (let i = 0; i < 40; i++) {
    const ok = await fetch(`http://127.0.0.1:${port}/`)
      .then((response) => response.ok)
      .catch(() => false)
    if (ok) return port
    await Bun.sleep(50)
  }
  throw new Error(`html server did not start on ${port}`)
}

function stubOpenRouterFetch() {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean }
    if (parsed.stream) {
      const sse = [
        `data: ${JSON.stringify({
          id: "chatcmpl-grist",
          object: "chat.completion.chunk",
          choices: [{ delta: { content: "hello from grist" } }],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-grist",
          object: "chat.completion.chunk",
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        })}`,
        "data: [DONE]",
        "",
      ].join("\n\n")
      return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    }
    return new Response(
      JSON.stringify({
        id: "chatcmpl-grist",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "hello from grist" } }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }
}

async function mintApiKey(base: string) {
  const minted = await fetch(`${base}/v1/admin/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Grist-Admin": "secret" },
    body: JSON.stringify({ cap_usd: 5 }),
  })
  const code = ((await minted.json()) as { code: string }).code
  const created = await fetch(`${base}/v1/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Grist-Invite": code },
    body: JSON.stringify({ name: "cli" }),
  })
  return ((await created.json()) as { key: string }).key
}

describe("grist auth login CLI", () => {
  test("auth login --help lists the Grist provider flags", async () => {
    const home = path.join(os.tmpdir(), `grist-cli-${crypto.randomUUID()}`)
    homes.push(home)
    const result = await runCli(["auth", "login", "--help"], isolatedEnv(home))
    expect(result.exitCode).toBe(0)
    expect(result.text).toContain("--provider")
    expect(result.text).toContain("api-key")
    expect(result.text.toLowerCase()).toContain("grist")
  }, 60_000)

  test("auth login <html-url> fails with a readable error, not a TypeError", async () => {
    const port = await startHtmlServer()
    const home = path.join(os.tmpdir(), `grist-cli-${crypto.randomUUID()}`)
    homes.push(home)
    const result = await runCli(["auth", "login", `http://127.0.0.1:${port}`], isolatedEnv(home))
    expect(result.text).not.toMatch(/undefined is not an object/i)
    expect(result.text).not.toMatch(/N\.auth\.command/)
    expect(result.text).toContain("not an OpenCode auth provider")
    expect(result.exitCode).not.toBe(0)
  }, 60_000)

  test("auth login <bad-url> fails with a readable error, not a TypeError", async () => {
    const home = path.join(os.tmpdir(), `grist-cli-${crypto.randomUUID()}`)
    homes.push(home)
    const result = await runCli(["auth", "login", "not-a-url"], isolatedEnv(home))
    expect(result.text).not.toMatch(/undefined is not an object/i)
    expect(result.text).not.toMatch(/N\.auth\.command/)
    expect(result.text).toContain("not a login URL")
    expect(result.exitCode).not.toBe(0)
  }, 60_000)

  test("auth login --provider grist accepts a live API key, providers list shows it, and run uses only Grist", async () => {
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "sk-or-test",
      fetch: stubOpenRouterFetch(),
    })
    const server = Bun.serve({ port: 0, fetch: gateway.fetch })
    procs.push({ kill: () => server.stop() })
    const base = `http://127.0.0.1:${server.port}`
    const key = await mintApiKey(base)
    const home = path.join(os.tmpdir(), `grist-cli-${crypto.randomUUID()}`)
    homes.push(home)
    const env = isolatedEnv(home, { GRIST_GATEWAY_URL: base })

    const login = await runCli(["auth", "login", "--provider", "grist", "--api-key", key, "--gateway", base], env)
    if (login.exitCode !== 0) throw new Error(login.text)
    expect(login.text).toMatch(/Logged into Grist/i)

    const listed = await runCli(["providers", "list"], env)
    if (listed.exitCode !== 0) throw new Error(listed.text)
    expect(listed.text.toLowerCase()).toContain("grist")

    const scratch = path.join(home, "scratch")
    fs.mkdirSync(scratch, { recursive: true })
    fs.writeFileSync(path.join(scratch, "README.md"), "scratch\n")
    const run = await runCli(["run", "reply with the word hello"], env, scratch)
    if (run.exitCode !== 0) throw new Error(run.text)
    expect(run.text.toLowerCase()).toContain("hello from grist")
  }, 90_000)
})
