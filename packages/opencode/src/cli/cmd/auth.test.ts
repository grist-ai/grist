import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { canPromptLogin, ensureSignedIn, runAuthApiKey } from "./auth"
import { saveInviteConfig, clearInviteConfig, loadInviteConfig } from "@/grist/invite/config"
import { createGateway } from "@/grist/gateway/http"
import { generateApiKeySecret } from "@/grist/gateway/codes"

const files: string[] = []
const servers: Array<{ stop: () => void }> = []

afterEach(() => {
  if (process.env.GRIST_CONFIG_PATH) clearInviteConfig()
  for (const file of files.splice(0)) fs.rmSync(file, { force: true })
  for (const server of servers.splice(0)) server.stop()
  delete process.env.GRIST_CONFIG_PATH
  delete process.env.GRIST_INVITE
  delete process.env.GRIST_API_KEY
  delete process.env.GRIST_GATEWAY_URL
})

describe("ensureSignedIn", () => {
  test("returns true when invite config already exists", async () => {
    const file = path.join(os.tmpdir(), `grist-auth-${crypto.randomUUID()}.json`)
    files.push(file)
    process.env.GRIST_CONFIG_PATH = file
    saveInviteConfig({ code: "grist-ABCD-2345", gatewayUrl: "http://127.0.0.1:8787" })
    expect(await ensureSignedIn()).toBe(true)
  })

  test("returns true when GRIST_API_KEY is set", async () => {
    delete process.env.GRIST_CONFIG_PATH
    delete process.env.GRIST_INVITE
    process.env.GRIST_API_KEY = "grist_sk_" + "ab".repeat(32)
    expect(await ensureSignedIn()).toBe(true)
  })

  test("returns false without a saved invite when stdin is not a TTY", async () => {
    const file = path.join(os.tmpdir(), `grist-auth-${crypto.randomUUID()}.json`)
    files.push(file)
    process.env.GRIST_CONFIG_PATH = file
    const previous = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false })
    expect(canPromptLogin()).toBe(false)
    expect(await ensureSignedIn()).toBe(false)
    if (previous) Object.defineProperty(process.stdin, "isTTY", previous)
    else delete (process.stdin as { isTTY?: boolean }).isTTY
  })
})

describe("runAuthApiKey", () => {
  test("rejects a malformed key without hitting the network", async () => {
    expect(await runAuthApiKey({ key: "sk-openai", gatewayUrl: "http://127.0.0.1:9" })).toEqual({
      ok: false,
      reason: "invalid",
    })
  })

  test("validates a live grist_sk_ key and persists it", async () => {
    const file = path.join(os.tmpdir(), `grist-auth-${crypto.randomUUID()}.json`)
    files.push(file)
    process.env.GRIST_CONFIG_PATH = file
    delete process.env.GRIST_API_KEY
    delete process.env.GRIST_INVITE

    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "sk-or-test",
      fetch: async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    })
    const server = Bun.serve({ port: 0, fetch: gateway.fetch })
    servers.push(server)
    const base = `http://127.0.0.1:${server.port}`

    const minted = await fetch(`${base}/v1/admin/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Grist-Admin": "secret" },
      body: JSON.stringify({ cap_usd: 5 }),
    })
    const code = ((await minted.json()) as { code: string }).code
    const created = await fetch(`${base}/v1/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Grist-Invite": code },
      body: JSON.stringify({ name: "agent" }),
    })
    const key = ((await created.json()) as { key: string }).key

    expect(await runAuthApiKey({ key: generateApiKeySecret(), gatewayUrl: base })).toEqual({
      ok: false,
      reason: "unauthorized",
    })

    const result = await runAuthApiKey({ key, gatewayUrl: base })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.key).toBe(key)
    expect(loadInviteConfig()?.kind).toBe("api_key")
    expect(loadInviteConfig()?.code).toBe(key)
    expect(loadInviteConfig()?.gatewayUrl).toBe(base)
  })
})
