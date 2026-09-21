import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { clearInviteConfig, gatewayAuthHeaders, loadInviteConfig, saveAuthConfig, saveInviteConfig } from "./config"
import { generateApiKeySecret } from "../gateway/codes"

describe("invite config", () => {
  test("round-trips ~/.grist/config.json via GRIST_CONFIG_PATH", () => {
    const file = path.join(os.tmpdir(), `grist-invite-${crypto.randomUUID()}.json`)
    process.env.GRIST_CONFIG_PATH = file
    delete process.env.GRIST_INVITE
    delete process.env.GRIST_API_KEY
    delete process.env.GRIST_GATEWAY_URL

    saveInviteConfig({ code: "grist-ABCD-2345", gatewayUrl: "http://127.0.0.1:8787/" })
    expect(fs.existsSync(file)).toBe(true)
    const loaded = loadInviteConfig()
    expect(loaded?.code).toBe("grist-ABCD-2345")
    expect(loaded?.gatewayUrl).toBe("http://127.0.0.1:8787")
    expect(loaded?.kind).toBe("invite")
    expect(gatewayAuthHeaders(loaded!)).toEqual({ "X-Grist-Invite": "grist-ABCD-2345" })

    clearInviteConfig()
    expect(loadInviteConfig()).toBeUndefined()

    delete process.env.GRIST_CONFIG_PATH
    fs.rmSync(file, { force: true })
  })

  test("prefers GRIST_API_KEY and defaults the gateway URL", () => {
    const file = path.join(os.tmpdir(), `grist-invite-${crypto.randomUUID()}.json`)
    process.env.GRIST_CONFIG_PATH = file
    delete process.env.GRIST_INVITE
    delete process.env.GRIST_GATEWAY_URL
    saveInviteConfig({ code: "grist-ABCD-2345", gatewayUrl: "http://127.0.0.1:8787" })
    const secret = generateApiKeySecret()
    process.env.GRIST_API_KEY = secret

    const loaded = loadInviteConfig()
    expect(loaded?.kind).toBe("api_key")
    expect(loaded?.code).toBe(secret)
    expect(loaded?.gatewayUrl).toBe("http://127.0.0.1:8787")
    expect(gatewayAuthHeaders(loaded!)).toEqual({ "X-Grist-Api-Key": secret })

    delete process.env.GRIST_API_KEY
    delete process.env.GRIST_CONFIG_PATH
    clearInviteConfig()
    process.env.GRIST_API_KEY = secret
    const envOnly = loadInviteConfig()
    expect(envOnly?.gatewayUrl).toBe("https://grist.lol")
    delete process.env.GRIST_API_KEY
    fs.rmSync(file, { force: true })
  })

  test("persists an API key in ~/.grist/config.json", () => {
    const file = path.join(os.tmpdir(), `grist-invite-${crypto.randomUUID()}.json`)
    process.env.GRIST_CONFIG_PATH = file
    delete process.env.GRIST_INVITE
    delete process.env.GRIST_API_KEY
    delete process.env.GRIST_GATEWAY_URL
    const secret = generateApiKeySecret()
    saveAuthConfig({ code: secret, gatewayUrl: "https://grist.lol/" })
    const loaded = loadInviteConfig()
    expect(loaded?.kind).toBe("api_key")
    expect(loaded?.code).toBe(secret)
    expect(loaded?.gatewayUrl).toBe("https://grist.lol")
    expect(gatewayAuthHeaders(loaded!)).toEqual({ "X-Grist-Api-Key": secret })
    clearInviteConfig()
    delete process.env.GRIST_CONFIG_PATH
    fs.rmSync(file, { force: true })
  })
})
