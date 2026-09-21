import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { clearInviteConfig, loadInviteConfig, saveInviteConfig } from "./config"

describe("invite config", () => {
  test("round-trips ~/.grist/config.json via GRIST_CONFIG_PATH", () => {
    const file = path.join(os.tmpdir(), `grist-invite-${crypto.randomUUID()}.json`)
    process.env.GRIST_CONFIG_PATH = file
    delete process.env.GRIST_INVITE
    delete process.env.GRIST_GATEWAY_URL

    saveInviteConfig({ code: "grist-ABCD-2345", gatewayUrl: "http://127.0.0.1:8787/" })
    expect(fs.existsSync(file)).toBe(true)
    const loaded = loadInviteConfig()
    expect(loaded?.code).toBe("grist-ABCD-2345")
    expect(loaded?.gatewayUrl).toBe("http://127.0.0.1:8787")

    clearInviteConfig()
    expect(loadInviteConfig()).toBeUndefined()

    delete process.env.GRIST_CONFIG_PATH
    fs.rmSync(file, { force: true })
  })
})
