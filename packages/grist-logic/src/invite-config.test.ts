import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadInviteConfig, writeInviteConfig } from "./invite-config.js"

const ORIGINAL_CONFIG_PATH = process.env.GRIST_CONFIG_PATH
let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "grist-config-test-"))
  process.env.GRIST_CONFIG_PATH = path.join(dir, "config.json")
})

afterEach(() => {
  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.GRIST_CONFIG_PATH
  else process.env.GRIST_CONFIG_PATH = ORIGINAL_CONFIG_PATH
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("writeInviteConfig", () => {
  test("round-trips through loadInviteConfig", () => {
    const file = writeInviteConfig({ code: "grist_sk_" + "a".repeat(64), gatewayUrl: "https://grist.lol" })
    expect(fs.existsSync(file)).toBe(true)
    const loaded = loadInviteConfig()
    expect(loaded?.code).toBe("grist_sk_" + "a".repeat(64))
    expect(loaded?.gatewayUrl).toBe("https://grist.lol")
    expect(loaded?.kind).toBe("api_key")
  })

  test("merges with existing keys instead of clobbering", () => {
    fs.writeFileSync(process.env.GRIST_CONFIG_PATH!, JSON.stringify({ keepMe: 42 }))
    writeInviteConfig({ code: "grist_sk_" + "b".repeat(64), gatewayUrl: "https://example.com" })
    const parsed = JSON.parse(fs.readFileSync(process.env.GRIST_CONFIG_PATH!, "utf8"))
    expect(parsed.keepMe).toBe(42)
    expect(parsed.code).toBe("grist_sk_" + "b".repeat(64))
  })

  test("locks the file down to owner-only permissions", () => {
    const file = writeInviteConfig({ code: "grist_sk_" + "c".repeat(64), gatewayUrl: "https://grist.lol" })
    const mode = fs.statSync(file).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
