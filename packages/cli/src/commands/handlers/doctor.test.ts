import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { checkAuth, compareVersions, describeInvite, formatChecklist, summarize, type CheckResult } from "./doctor"

const results = (statuses: CheckResult["status"][]): CheckResult[] =>
  statuses.map((status, i) => ({ name: `check-${i}`, status, detail: "detail" }))

describe("doctor", () => {
  test("compareVersions orders semver triples", () => {
    expect(compareVersions("0.1.7", "0.1.8")).toBe(-1)
    expect(compareVersions("0.1.8", "0.1.8")).toBe(0)
    expect(compareVersions("0.2.0", "0.1.8")).toBe(1)
    expect(compareVersions("v0.1.8", "0.1.8")).toBe(0)
    expect(compareVersions("0.1", "0.1.0")).toBe(0)
  })

  test("describeInvite never leaks the credential", () => {
    const signed = describeInvite({
      code: "grist_sk_super_secret_value",
      gatewayUrl: "https://grist.lol",
      kind: "api_key",
    })
    expect(signed.status).toBe("pass")
    expect(signed.detail).toContain("api key")
    expect(signed.detail).toContain("https://grist.lol")
    expect(signed.detail).not.toContain("grist_sk_super_secret_value")

    const invite = describeInvite({ code: "grist-AAAA-1111", gatewayUrl: "https://x", kind: "invite" })
    expect(invite.status).toBe("pass")
    expect(invite.detail).toContain("invite code")
    expect(invite.detail).not.toContain("grist-AAAA-1111")

    const missing = describeInvite(undefined)
    expect(missing.status).toBe("fail")
    expect(missing.detail).toContain("grist auth login")
  })

  test("summarize counts by status", () => {
    expect(summarize(results(["pass", "warn", "fail", "pass"]))).toEqual({ pass: 2, warn: 1, fail: 1 })
  })

  test("formatChecklist renders markers and a verdict", () => {
    const text = formatChecklist(results(["pass", "warn", "fail"]))
    expect(text).toContain("✓ check-0")
    expect(text).toContain("! check-1")
    expect(text).toContain("✗ check-2")
    expect(text).toContain("doctor found problems")
    const clean = formatChecklist(results(["pass", "pass"]))
    expect(clean).toContain("all checks passed")
  })
})

const apiKey = "grist_sk_" + "d".repeat(64)
const ORIGINAL_CONFIG_PATH = process.env.GRIST_CONFIG_PATH
const ORIGINAL_API_KEY = process.env.GRIST_API_KEY
const ORIGINAL_INVITE = process.env.GRIST_INVITE
const originalFetch = globalThis.fetch
let dir: string

const stubFetch = (impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) => {
  globalThis.fetch = impl as unknown as typeof fetch
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "grist-doctor-test-"))
  process.env.GRIST_CONFIG_PATH = path.join(dir, "config.json")
  delete process.env.GRIST_API_KEY
  delete process.env.GRIST_INVITE
  fs.writeFileSync(process.env.GRIST_CONFIG_PATH, JSON.stringify({ code: apiKey, gatewayUrl: "https://grist.test" }))
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.GRIST_CONFIG_PATH
  else process.env.GRIST_CONFIG_PATH = ORIGINAL_CONFIG_PATH
  if (ORIGINAL_API_KEY === undefined) delete process.env.GRIST_API_KEY
  else process.env.GRIST_API_KEY = ORIGINAL_API_KEY
  if (ORIGINAL_INVITE === undefined) delete process.env.GRIST_INVITE
  else process.env.GRIST_INVITE = ORIGINAL_INVITE
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("checkAuth", () => {
  test("verifies the credential with one authenticated call", async () => {
    let seen: { url: string; headers?: HeadersInit } | undefined
    stubFetch(async (url, init) => {
      seen = { url: String(url), headers: init?.headers }
      return new Response("{}", { status: 200 })
    })

    const result = await checkAuth()
    expect(result.status).toBe("pass")
    expect(result.detail).toContain("key verified")
    expect(result.detail).not.toContain(apiKey)
    expect(seen?.url).toBe("https://grist.test/v1/provider")
    expect(seen?.headers).toMatchObject({ "X-Grist-Api-Key": apiKey })
  })

  test("fails when the gateway rejects the credential", async () => {
    stubFetch(async () => new Response("", { status: 401 }))

    const result = await checkAuth()
    expect(result.status).toBe("fail")
    expect(result.detail).toContain("rejected the credential")
    expect(result.detail).toContain("grist auth login")
    expect(result.detail).not.toContain(apiKey)
  })

  test("warns, not fails, when the gateway is unreachable", async () => {
    stubFetch(async () => {
      throw new Error("connect ECONNREFUSED")
    })

    const result = await checkAuth()
    expect(result.status).toBe("warn")
    expect(result.detail).toContain("could not validate the key")
    expect(result.detail).toContain("ECONNREFUSED")
  })

  test("fails without calling the gateway when no credential is stored", async () => {
    fs.rmSync(process.env.GRIST_CONFIG_PATH!)
    stubFetch(async () => {
      throw new Error("should not be called")
    })

    const result = await checkAuth()
    expect(result.status).toBe("fail")
    expect(result.detail).toContain("grist auth login")
  })
})
