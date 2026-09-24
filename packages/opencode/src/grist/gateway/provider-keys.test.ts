import { describe, expect, test } from "bun:test"
import { createGateway } from "./http"
import { priceForModel, usdForUsage } from "./prices"
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

describe("invite-optional auth (GRIST_REQUIRE_INVITE)", () => {
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
        body: method === "GET" ? undefined : JSON.stringify(input?.body ?? {}),
      }),
    )
    const text = await response.text()
    return { status: response.status, json: (text ? JSON.parse(text) : undefined) as Record<string, unknown> }
  }

  function withRequireInvite(value: string | undefined, fn: () => Promise<void>) {
    return (async () => {
      const previous = process.env.GRIST_REQUIRE_INVITE
      if (value === undefined) delete process.env.GRIST_REQUIRE_INVITE
      else process.env.GRIST_REQUIRE_INVITE = value
      try {
        await fn()
      } finally {
        if (previous === undefined) delete process.env.GRIST_REQUIRE_INVITE
        else process.env.GRIST_REQUIRE_INVITE = previous
      }
    })()
  }

  test("device approval mints an account code when invites are off", () =>
    withRequireInvite(undefined, async () => {
      const store = openGatewayStore(":memory:")
      const gateway = createGateway({ store })
      const started = await call(gateway.fetch, "POST", "/v1/auth/device", {})
      const approved = await call(gateway.fetch, "POST", "/v1/auth/device/approve", {
        body: { user_code: started.json.user_code, code: "" },
      })
      expect(approved.json.ok).toBe(true)
      const polled = await call(gateway.fetch, "POST", "/v1/auth/device/poll", {
        body: { device_code: started.json.device_code },
      })
      expect(polled.json.status).toBe("approved")
      expect(typeof polled.json.code).toBe("string")
    }))

  test("device approval still requires an invite when GRIST_REQUIRE_INVITE=1", () =>
    withRequireInvite("1", async () => {
      const store = openGatewayStore(":memory:")
      const gateway = createGateway({ store })
      const started = await call(gateway.fetch, "POST", "/v1/auth/device", {})
      const approved = await call(gateway.fetch, "POST", "/v1/auth/device/approve", {
        body: { user_code: started.json.user_code, code: "" },
      })
      expect(approved.json.ok).toBe(false)
    }))

  test("session reports invite_required and skips the invite step when off", () =>
    withRequireInvite(undefined, async () => {
      process.env.FIREBASE_API_KEY = "test"
      process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
      process.env.FIREBASE_PROJECT_ID = "grist-test"
      process.env.FIREBASE_APP_ID = "1:1:web:abc"
      try {
        const gateway = createGateway({
          fetch: async () =>
            new Response(JSON.stringify({ users: [{ localId: "uid_new", email: "new@example.com" }] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        })
        const session = await call(gateway.fetch, "POST", "/v1/auth/session", {
          body: { id_token: "tok" },
        })
        expect(session.json.needs_invite).toBe(false)
        expect(session.json.invite_required).toBe(false)
      } finally {
        delete process.env.FIREBASE_API_KEY
        delete process.env.FIREBASE_AUTH_DOMAIN
        delete process.env.FIREBASE_PROJECT_ID
        delete process.env.FIREBASE_APP_ID
      }
    }))

  test("session still demands an invite when GRIST_REQUIRE_INVITE=1", () =>
    withRequireInvite("1", async () => {
      process.env.FIREBASE_API_KEY = "test"
      process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
      process.env.FIREBASE_PROJECT_ID = "grist-test"
      process.env.FIREBASE_APP_ID = "1:1:web:abc"
      try {
        const gateway = createGateway({
          fetch: async () =>
            new Response(JSON.stringify({ users: [{ localId: "uid_new2", email: "new2@example.com" }] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        })
        const session = await call(gateway.fetch, "POST", "/v1/auth/session", {
          body: { id_token: "tok" },
        })
        expect(session.json.needs_invite).toBe(true)
        expect(session.json.invite_required).toBe(true)
      } finally {
        delete process.env.FIREBASE_API_KEY
        delete process.env.FIREBASE_AUTH_DOMAIN
        delete process.env.FIREBASE_PROJECT_ID
        delete process.env.FIREBASE_APP_ID
      }
    }))
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

describe("BYOK request routing", () => {
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
        body: method === "GET" ? undefined : JSON.stringify(input?.body ?? {}),
      }),
    )
    const text = await response.text()
    return { status: response.status, json: (text ? JSON.parse(text) : undefined) as Record<string, unknown> }
  }

  type SeenRequest = { url: string; auth: string | null; body: unknown }
  function captureFetch(seen: SeenRequest[]) {
    return async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(input),
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body ?? "{}")),
      })
      return new Response(JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
  }

  async function gatewayWithCredential(credential: { provider: string; apiKey: string }) {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite()
    store.setProviderCredential({ inviteCode: invite.code, provider: credential.provider as "vercel", apiKey: credential.apiKey })
    const seen: SeenRequest[] = []
    const gateway = createGateway({ store, openrouterKey: "or-house-key", fetch: captureFetch(seen) })
    return { gateway, headers: { "X-Grist-Invite": invite.code }, seen }
  }

  test("completions ride the caller's provider key and endpoint", async () => {
    const { gateway, headers, seen } = await gatewayWithCredential({ provider: "vercel", apiKey: "vck_user_key" })
    const response = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers,
      body: { model: "cheapest", messages: [{ role: "user", content: "hi" }], stream: false },
    })
    expect(response.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions")
    expect(seen[0]?.auth).toBe("Bearer vck_user_key")
    expect((seen[0]?.body as { model: string }).model).toBe("deepseek/deepseek-v4.1-flash")
  })

  test("completions fall back to the house key without a credential", async () => {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite()
    const seen: SeenRequest[] = []
    const gateway = createGateway({ store, openrouterKey: "or-house-key", fetch: captureFetch(seen) })
    const response = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": invite.code },
      body: { model: "medium", messages: [{ role: "user", content: "hi" }], stream: false },
    })
    expect(response.status).toBe(200)
    expect(seen[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(seen[0]?.auth).toBe("Bearer or-house-key")
    expect((seen[0]?.body as { model: string }).model).toBe("moonshotai/kimi-k3")
  })

  test("completions 503 with no credential and no house key", async () => {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite()
    const gateway = createGateway({ store, fetch: captureFetch([]) })
    const response = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": invite.code },
      body: { model: "cheapest", messages: [{ role: "user", content: "hi" }], stream: false },
    })
    expect(response.status).toBe(503)
  })

  test("custom credential without a model for the rung is a 503, not a silent fallback", async () => {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite()
    store.setProviderCredential({
      inviteCode: invite.code,
      provider: "custom",
      apiKey: "custom-key",
      baseURL: "https://llm.example.com/v1",
      // no customModels: nothing to resolve the rung to
    })
    const gateway = createGateway({ store, openrouterKey: "or-house-key", fetch: captureFetch([]) })
    const response = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": invite.code },
      body: { model: "cheapest", messages: [{ role: "user", content: "hi" }], stream: false },
    })
    expect(response.status).toBe(503)
    expect(response.json.error).toBe("provider is misconfigured for this rung")
  })

  test("gate route scores on the caller's key at their Jev endpoint", async () => {
    const { gateway, headers, seen } = await gatewayWithCredential({ provider: "openrouter", apiKey: "sk-or-user-key" })
    const response = await call(gateway.fetch, "POST", "/v1/gate/route", {
      headers,
      body: { text: "refactor the auth module to use the new session store" },
    })
    expect(response.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toContain("openrouter.ai")
    expect(seen[0]?.auth).toBe("Bearer sk-or-user-key")
  })

  test("gate route falls back to the house Jev route without a credential", async () => {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite()
    const seen: SeenRequest[] = []
    const gateway = createGateway({ store, openrouterKey: "or-house-key", fetch: captureFetch(seen) })
    const response = await call(gateway.fetch, "POST", "/v1/gate/route", {
      headers: { "X-Grist-Invite": invite.code },
      body: { text: "refactor the auth module to use the new session store" },
    })
    expect(response.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.auth).toBe("Bearer or-house-key")
  })
})

describe("BYOK metering", () => {
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
        body: method === "GET" ? undefined : JSON.stringify(input?.body ?? {}),
      }),
    )
    const text = await response.text()
    return { status: response.status, json: (text ? JSON.parse(text) : undefined) as Record<string, unknown> }
  }

  function captureFetch() {
    return async (_input: string | URL | Request, init?: RequestInit) => {
      void init
      return new Response(JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 500 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
  }

  test("vercel prices strip the OpenRouter markup", () => {
    const model = "deepseek/deepseek-v4.1-flash"
    const house = usdForUsage(model, 1_000_000, 1_000_000, { provider: "openrouter" })
    const vercel = usdForUsage(model, 1_000_000, 1_000_000, { provider: "vercel" })
    expect(house).toBeGreaterThan(0)
    expect(vercel).toBeCloseTo(house / 1.055, 10)
  })

  test("custom providers meter at zero — their rates are unknowable", () => {
    expect(priceForModel("deepseek/deepseek-v4.1-flash", Date.now(), {}, "custom")).toBeUndefined()
    expect(priceForModel("cheapest", Date.now(), {}, "custom")).toBeUndefined()
    expect(usdForUsage("deepseek/deepseek-v4.1-flash", 1_000_000, 1_000_000, { provider: "custom" })).toBe(0)
  })

  test("over-cap is a hard 402 on the house key, soft on the caller's key", async () => {
    const alerts: string[] = []
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite({ capUsd: 0.000001 })
    const headers = { "X-Grist-Invite": invite.code }
    const gateway = createGateway({ store, openrouterKey: "or-house-key", fetch: captureFetch(), alert: (m) => alerts.push(m) })
    const completions = () =>
      call(gateway.fetch, "POST", "/v1/chat/completions", {
        headers,
        body: { model: "cheapest", messages: [{ role: "user", content: "hi" }], stream: false },
      })

    // Burn through the tiny cap on the house key.
    expect((await completions()).status).toBe(200)
    // Over cap on the house key: hard block.
    const blocked = await completions()
    expect(blocked.status).toBe(402)

    // Same account, now on its own provider key: soft cap serves.
    store.setProviderCredential({ inviteCode: invite.code, provider: "vercel", apiKey: "vck_user_key" })
    expect((await completions()).status).toBe(200)
    expect((await completions()).status).toBe(200)
    expect(alerts.filter((m) => m.includes("soft cap"))).toHaveLength(1)
  })

  test("gate route soft-caps on the caller's key", async () => {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite({ capUsd: 0.000001 })
    store.setProviderCredential({ inviteCode: invite.code, provider: "openrouter", apiKey: "sk-or-user-key" })
    store.addSpend({
      code: invite.code,
      keyId: null,
      model: "cheapest",
      rung: "cheapest",
      inputTokens: 0,
      outputTokens: 0,
      usd: 1,
    })
    const gateway = createGateway({ store, openrouterKey: "or-house-key", fetch: captureFetch() })
    const response = await call(gateway.fetch, "POST", "/v1/gate/route", {
      headers: { "X-Grist-Invite": invite.code },
      body: { text: "refactor the auth module to use the new session store" },
    })
    expect(response.status).toBe(200)
  })

  test("/v1/usage reports the configured provider", async () => {
    const store = openGatewayStore(":memory:", { masterKey: TEST_MASTER_KEY })
    const invite = store.createInvite()
    store.setProviderCredential({ inviteCode: invite.code, provider: "vercel", apiKey: "vck_user_key" })
    const gateway = createGateway({ store, fetch: captureFetch() })
    const response = await call(gateway.fetch, "GET", "/v1/usage", { headers: { "X-Grist-Invite": invite.code } })
    expect(response.status).toBe(200)
    expect(response.json.provider).toBe("vercel")
  })
})
