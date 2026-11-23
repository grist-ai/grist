import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { writeInviteConfig } from "@grist-ai/logic"
import { formatGristStatus, gristStatus, gristStatusJson, type SessionLookup } from "./grist-status"

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "grist-status-test-"))
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

describe("gristStatus", () => {
  test("signed out points at grist login", async () => {
    const status = await run(gristStatus({}))
    expect(status.signedIn).toBe(false)
    const text = formatGristStatus(status)
    expect(text).toContain("Not signed in to Grist")
    expect(text).toContain("grist auth login --provider grist")
    expect(gristStatusJson(status)).toEqual({ signed_in: false })
  })

  test("signed in via website sign-in renders gateway-resolved identity, never the code", async () => {
    writeInviteConfig({ code: inviteCode, gatewayUrl: "https://grist.example" })
    const session: SessionLookup = async (config) => {
      expect(config.gatewayUrl).toBe("https://grist.example")
      return { email: "pranav@example.com", userId: "gu_test12345" }
    }
    const status = await run(gristStatus({ session }))
    expect(status.signedIn).toBe(true)
    expect(status.method).toBe("website")
    expect(status.gatewayUrl).toBe("https://grist.example")
    expect(status.email).toBe("pranav@example.com")
    expect(status.userId).toBe("gu_test12345")
    expect(status.refreshed).toBe(true)

    const text = formatGristStatus(status)
    expect(text).toContain("website sign-in")
    expect(text).toContain("pranav@example.com")
    expect(text).toContain("gu_test12345")
    expect(text).not.toContain(inviteCode)

    const json = gristStatusJson(status)
    expect(json).toEqual({
      signed_in: true,
      method: "website",
      gateway_url: "https://grist.example",
      email: "pranav@example.com",
      user_id: "gu_test12345",
      refreshed: true,
    })
    expect(JSON.stringify(json)).not.toContain(inviteCode)
  })

  test("signed in via API key degrades gracefully when the gateway is unreachable", async () => {
    writeInviteConfig({ code: apiKey, gatewayUrl: "https://grist.example" })
    const session: SessionLookup = async () => undefined
    const status = await run(gristStatus({ session }))
    expect(status.signedIn).toBe(true)
    expect(status.method).toBe("api_key")
    expect(status.refreshed).toBe(false)
    const text = formatGristStatus(status)
    expect(text).toContain("API key")
    expect(text).toContain("could not be refreshed")
    expect(text).not.toContain(apiKey)
    expect(JSON.stringify(gristStatusJson(status))).not.toContain(apiKey)
  })

  test("default lookup parses identity from the gateway /v1/usage account field", async () => {
    const savedGatewayUrl = process.env.GRIST_GATEWAY_URL
    delete process.env.GRIST_GATEWAY_URL
    let seenPath = ""
    let seenInvite = ""
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        seenPath = new URL(req.url).pathname
        seenInvite = req.headers.get("X-Grist-Invite") ?? ""
        return Response.json({
          spent_usd: 0,
          cap_usd: 10,
          remaining_usd: 10,
          plan: "beta",
          provider: null,
          provider_source: null,
          account: { email: "default-lookup@example.com", user_id: "gu_default42" },
          expires_at: "2027-01-01T00:00:00.000Z",
          by_rung: { cheapest: 0, medium: 0, frontier: 0, premium: 0 },
        })
      },
    })
    try {
      writeInviteConfig({ code: inviteCode, gatewayUrl: `http://127.0.0.1:${server.port}` })
      const status = await run(gristStatus({}))
      expect(seenPath).toBe("/v1/usage")
      expect(seenInvite).toBe(inviteCode)
      expect(status.signedIn).toBe(true)
      expect(status.refreshed).toBe(true)
      expect(status.email).toBe("default-lookup@example.com")
      expect(status.userId).toBe("gu_default42")
      const text = formatGristStatus(status)
      expect(text).toContain("default-lookup@example.com")
      expect(text).toContain("gu_default42")
      expect(text).not.toContain(inviteCode)
      expect(gristStatusJson(status)).toEqual({
        signed_in: true,
        method: "website",
        gateway_url: `http://127.0.0.1:${server.port}`,
        email: "default-lookup@example.com",
        user_id: "gu_default42",
        refreshed: true,
      })
    } finally {
      server.stop(true)
      restore("GRIST_GATEWAY_URL", savedGatewayUrl)
    }
  })

  test("default lookup stays refreshed without identity when the account field is null", async () => {
    const savedGatewayUrl = process.env.GRIST_GATEWAY_URL
    delete process.env.GRIST_GATEWAY_URL
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json({ account: null })
      },
    })
    try {
      writeInviteConfig({ code: inviteCode, gatewayUrl: `http://127.0.0.1:${server.port}` })
      const status = await run(gristStatus({}))
      expect(status.signedIn).toBe(true)
      expect(status.refreshed).toBe(true)
      expect(status.email).toBeUndefined()
      expect(status.userId).toBeUndefined()
    } finally {
      server.stop(true)
      restore("GRIST_GATEWAY_URL", savedGatewayUrl)
    }
  })

  test("a failing session lookup still reports the locally stored state", async () => {
    writeInviteConfig({ code: inviteCode, gatewayUrl: "https://grist.example" })
    const session: SessionLookup = async () => {
      throw new Error("network down")
    }
    const status = await run(gristStatus({ session }))
    expect(status.signedIn).toBe(true)
    expect(status.method).toBe("website")
    expect(status.refreshed).toBe(false)
  })
})
