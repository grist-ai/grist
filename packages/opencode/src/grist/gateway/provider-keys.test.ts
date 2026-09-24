import { describe, expect, test } from "bun:test"
import { createGateway } from "./http"
import { openGatewayStore } from "./store"
import {
  decryptProviderKey,
  encryptProviderKey,
  fingerprintKey,
  parseMasterKey,
} from "./provider-keys"

const TEST_MASTER_KEY = parseMasterKey("ab".repeat(32)) as Buffer

describe("parseMasterKey", () => {
  test("accepts 64 hex chars", () => {
    const key = parseMasterKey("ab".repeat(32))
    expect(key?.length).toBe(32)
  })
  test("accepts base64 encoding 32 bytes", () => {
    const key = parseMasterKey(Buffer.alloc(32, 7).toString("base64"))
    expect(key?.length).toBe(32)
    expect(key?.[0]).toBe(7)
  })
  test("rejects passphrases, short keys, garbage", () => {
    expect(parseMasterKey("correct horse battery staple")).toBeUndefined()
    expect(parseMasterKey("ab".repeat(16))).toBeUndefined()
    expect(parseMasterKey("not-base64!!!")).toBeUndefined()
    expect(parseMasterKey("")).toBeUndefined()
    expect(parseMasterKey(undefined)).toBeUndefined()
  })
})

describe("provider key encryption", () => {
  test("round-trips the key", () => {
    const blob = encryptProviderKey("sk-or-test-key", TEST_MASTER_KEY)
    expect(blob).not.toContain("sk-or-test-key")
    expect(decryptProviderKey(blob, TEST_MASTER_KEY)).toBe("sk-or-test-key")
  })
  test("wrong master key fails closed", () => {
    const blob = encryptProviderKey("sk-or-test-key", TEST_MASTER_KEY)
    const wrong = parseMasterKey("cd".repeat(32)) as Buffer
    expect(() => decryptProviderKey(blob, wrong)).toThrow()
  })
  test("tampered blob fails closed", () => {
    const blob = encryptProviderKey("sk-or-test-key", TEST_MASTER_KEY)
    const bytes = Buffer.from(blob, "base64")
    bytes[bytes.length - 1] ^= 0xff
    expect(() => decryptProviderKey(bytes.toString("base64"), TEST_MASTER_KEY)).toThrow()
  })
  test("fingerprint is stable and reveals nothing", () => {
    const fp = fingerprintKey("sk-or-test-key")
    expect(fp).toBe(fingerprintKey("sk-or-test-key"))
    expect(fp).not.toContain("sk-or-test-key")
    expect(fp).toHaveLength(64)
  })
})

describe("provider credential store", () => {
  test("set/get/delete round-trip decrypts in memory only", () => {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite()
    const summary = store.setProviderCredential({
      inviteCode: invite.code,
      provider: "openrouter",
      apiKey: "sk-or-test-key",
    })
    expect(summary.provider).toBe("openrouter")
    expect(summary.keyFingerprint).toBe(fingerprintKey("sk-or-test-key"))
    expect(JSON.stringify(summary)).not.toContain("sk-or-test-key")

    const credential = store.getProviderCredential(invite.code)
    expect(credential?.apiKey).toBe("sk-or-test-key")
    expect(credential?.provider).toBe("openrouter")

    expect(store.deleteProviderCredential(invite.code)).toBe(true)
    expect(store.getProviderCredential(invite.code)).toBeUndefined()
    expect(store.deleteProviderCredential(invite.code)).toBe(false)
  })
  test("custom provider stores base URL and model map", () => {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite()
    store.setProviderCredential({
      inviteCode: invite.code,
      provider: "custom",
      apiKey: "custom-key",
      baseURL: "https://llm.example.com/v1/",
      customModels: { cheapest: "my-org/my-model" },
    })
    const credential = store.getProviderCredential(invite.code)
    expect(credential?.baseURL).toBe("https://llm.example.com/v1")
    expect(credential?.customModels).toEqual({ cheapest: "my-org/my-model" })
    expect(store.providerCredentialSummary(invite.code)?.hasCustomModels).toBe(true)
  })
  test("fails closed without a master key", () => {
    const store = openGatewayStore(":memory:")
    const invite = store.createInvite()
    expect(() =>
      store.setProviderCredential({ inviteCode: invite.code, provider: "vercel", apiKey: "vck_test" }),
    ).toThrow("GRIST_MASTER_KEY is not configured")
    expect(store.getProviderCredential(invite.code)).toBeUndefined()
  })
})

describe("POST /v1/provider", () => {
  async function authedGateway() {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite()
    const gateway = createGateway({ store })
    const headers = { "X-Grist-Invite": invite.code }
    return { gateway, headers, invite }
  }

  async function call(
    fetch: (req: Request, peerIp?: string) => Promise<Response>,
    method: string,
    path: string,
    input?: { headers?: Record<string, string>; body?: unknown },
  ) {
    const response = await fetch(
      new Request(`http://gateway.test${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...input?.headers },
        body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(input?.body ?? {}),
      }),
    )
    const text = await response.text()
    return { status: response.status, json: (text ? JSON.parse(text) : undefined) as Record<string, unknown> }
  }

  test("sets a key, returns the fingerprint but never the key", async () => {
    const { gateway, headers } = await authedGateway()
    const set = await call(gateway.fetch, "POST", "/v1/provider", {
      headers,
      body: { provider: "vercel", api_key: "vck_test_key" },
    })
    expect(set.status).toBe(200)
    expect(set.json.provider).toBe("vercel")
    expect(typeof set.json.keyFingerprint).toBe("string")
    expect(JSON.stringify(set.json)).not.toContain("vck_test_key")

    const get = await call(gateway.fetch, "GET", "/v1/provider", { headers })
    expect(get.status).toBe(200)
    expect(get.json.provider).toBe("vercel")
    expect(JSON.stringify(get.json)).not.toContain("vck_test_key")
  })

  test("rejects bad provider, missing key, custom without base URL", async () => {
    const { gateway, headers } = await authedGateway()
    const badProvider = await call(gateway.fetch, "POST", "/v1/provider", {
      headers,
      body: { provider: "anthropic", api_key: "x" },
    })
    expect(badProvider.status).toBe(400)
    const missingKey = await call(gateway.fetch, "POST", "/v1/provider", {
      headers,
      body: { provider: "openrouter" },
    })
    expect(missingKey.status).toBe(400)
    const customNoBase = await call(gateway.fetch, "POST", "/v1/provider", {
      headers,
      body: { provider: "custom", api_key: "x" },
    })
    expect(customNoBase.status).toBe(400)
    const badModels = await call(gateway.fetch, "POST", "/v1/provider", {
      headers,
      body: { provider: "custom", api_key: "x", base_url: "https://llm.example.com", models: { nope: 1 } },
    })
    expect(badModels.status).toBe(400)
  })

  test("deletes the credential", async () => {
    const { gateway, headers } = await authedGateway()
    await call(gateway.fetch, "POST", "/v1/provider", {
      headers,
      body: { provider: "openrouter", api_key: "sk-or-x" },
    })
    const deleted = await call(gateway.fetch, "DELETE", "/v1/provider", { headers })
    expect(deleted.status).toBe(200)
    expect(deleted.json.revoked).toBe(true)
    const get = await call(gateway.fetch, "GET", "/v1/provider", { headers })
    expect(get.json.provider).toBeNull()
  })

  test("requires auth", async () => {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const gateway = createGateway({ store })
    const set = await call(gateway.fetch, "POST", "/v1/provider", {
      body: { provider: "openrouter", api_key: "x" },
    })
    expect(set.status).toBe(401)
  })

  test("503 when the gateway has no master key", async () => {
    const store = openGatewayStore(":memory:")
    const invite = store.createInvite()
    const gateway = createGateway({ store })
    const set = await call(gateway.fetch, "POST", "/v1/provider", {
      headers: { "X-Grist-Invite": invite.code },
      body: { provider: "openrouter", api_key: "x" },
    })
    expect(set.status).toBe(503)
  })
})
