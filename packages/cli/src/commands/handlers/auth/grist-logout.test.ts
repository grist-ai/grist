import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadInviteConfig, writeInviteConfig } from "@grist-ai/logic"
import { gristLogout } from "./grist-logout"

const ORIGINAL = {
  configPath: process.env.GRIST_CONFIG_PATH,
  apiKey: process.env.GRIST_API_KEY,
  invite: process.env.GRIST_INVITE,
}
let dir: string

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "grist-logout-test-"))
  process.env.GRIST_CONFIG_PATH = path.join(dir, "config.json")
  delete process.env.GRIST_API_KEY
  delete process.env.GRIST_INVITE
})

afterEach(() => {
  restore("GRIST_CONFIG_PATH", ORIGINAL.configPath)
  restore("GRIST_API_KEY", ORIGINAL.apiKey)
  restore("GRIST_INVITE", ORIGINAL.invite)
  fs.rmSync(dir, { recursive: true, force: true })
})

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect as Effect.Effect<A, E, never>)

const inviteCode = "GRIST-AAAA-1111"
const apiKey = "grist_sk_" + "d".repeat(64)

describe("gristLogout", () => {
  test("removes the stored credential and leaves other config keys in place", async () => {
    const file = writeInviteConfig({ code: inviteCode, gatewayUrl: "https://grist.example" })
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
    fs.writeFileSync(file, JSON.stringify({ ...parsed, other: true }, null, 2) + "\n")
    expect(loadInviteConfig()?.code).toBe(inviteCode)

    const result = await run(gristLogout({}))
    expect(result.outcome).toBe("removed")
    expect(result.fileCleared).toBe(true)
    expect(result.method).toBe("website")
    expect(result.gatewayUrl).toBe("https://grist.example")

    const after = JSON.parse(fs.readFileSync(file, "utf8"))
    expect(after.code).toBeUndefined()
    expect(after.other).toBe(true)
    expect(loadInviteConfig()).toBeUndefined()
  })

  test("removes a stored API key", async () => {
    writeInviteConfig({ code: apiKey, gatewayUrl: "https://grist.example" })
    const result = await run(gristLogout({}))
    expect(result.outcome).toBe("removed")
    expect(result.method).toBe("api_key")
    expect(loadInviteConfig()).toBeUndefined()
  })

  test("is a clean no-op when signed out", async () => {
    const result = await run(gristLogout({}))
    expect(result.outcome).toBe("not-signed-in")
    expect(result.fileCleared).toBe(false)
    expect(fs.existsSync(process.env.GRIST_CONFIG_PATH!)).toBe(false)
  })

  test("reports an environment credential instead of pretending to remove it", async () => {
    process.env.GRIST_API_KEY = apiKey
    const result = await run(gristLogout({}))
    expect(result.outcome).toBe("env-credential")
    expect(result.fileCleared).toBe(false)
    expect(loadInviteConfig()?.kind).toBe("api_key")
  })
})
