import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { gristDeviceLogin, gristLogin, type DeviceStart, type DevicePoll } from "./grist-login"

const ORIGINAL_CONFIG_PATH = process.env.GRIST_CONFIG_PATH
let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "grist-login-test-"))
  process.env.GRIST_CONFIG_PATH = path.join(dir, "config.json")
})

afterEach(() => {
  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.GRIST_CONFIG_PATH
  else process.env.GRIST_CONFIG_PATH = ORIGINAL_CONFIG_PATH
  fs.rmSync(dir, { recursive: true, force: true })
})

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect as Effect.Effect<A, E, never>)

const apiKey = "grist_sk_" + "d".repeat(64)

describe("gristLogin", () => {
  test("rejects unknown providers", async () => {
    const result = await run(Effect.flip(gristLogin({ provider: "openrouter" })))
    expect(result.message).toContain("openrouter")
  })

  test("--api-key writes the key without any network", async () => {
    await run(gristLogin({ provider: "Grist", apiKey }))
    const parsed = JSON.parse(fs.readFileSync(process.env.GRIST_CONFIG_PATH!, "utf8"))
    expect(parsed.code).toBe(apiKey)
    expect(parsed.gatewayUrl).toBe("https://grist.lol")
  })

  test("--api-key rejects malformed keys", async () => {
    const result = await run(Effect.flip(gristLogin({ provider: "grist", apiKey: "not-a-key" })))
    expect(result.message).toContain("API key")
    expect(fs.existsSync(process.env.GRIST_CONFIG_PATH!)).toBe(false)
  })

  test("device flow polls until approved and saves the credential", async () => {
    const start: DeviceStart = async () => ({
      device_code: "device-1",
      user_code: "ABCD-1234",
      verification_uri: "/login?device=ABCD-1234",
      interval: 0,
      expires_in: 60,
    })
    let polls = 0
    const poll: DevicePoll = async () => {
      polls += 1
      return polls < 2 ? { status: "pending" as const } : { status: "approved" as const, code: "GRIST-AAAA-1111" }
    }
    await run(gristDeviceLogin({ gatewayUrl: "https://grist.example", start, poll }))
    const parsed = JSON.parse(fs.readFileSync(process.env.GRIST_CONFIG_PATH!, "utf8"))
    expect(parsed.code).toBe("GRIST-AAAA-1111")
    expect(parsed.gatewayUrl).toBe("https://grist.example")
  })

  test("device flow fails when the code expires", async () => {
    const start: DeviceStart = async () => ({
      device_code: "device-2",
      user_code: "WXYZ-9999",
      verification_uri: "/login?device=WXYZ-9999",
      interval: 0,
      expires_in: 60,
    })
    const poll: DevicePoll = async () => ({ status: "expired" as const })
    const result = await run(Effect.flip(gristDeviceLogin({ gatewayUrl: "https://grist.example", start, poll })))
    expect(result.message).toContain("expired")
    expect(fs.existsSync(process.env.GRIST_CONFIG_PATH!)).toBe(false)
  })
})
