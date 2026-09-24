import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import os from "os"
import path from "path"
import { canonicalApiKey, canonicalDeviceUserCode, canonicalInviteCode, generateApiKeySecret, generateDeviceUserCode, generateInviteCode } from "./codes"
import { usdForUsage } from "./prices"
import { createGateway, MAX_COMPLETION_TOKENS } from "./http"
import { openGatewayStore } from "./store"
import { RUNG_MODELS } from "./ladder"

test("admin email has no hardcoded default (env-only)", async () => {
  // Without the adminEmail opt or GRIST_ADMIN_EMAIL env, no email matches —
  // the Google sign-in admin shortcut stays disabled by default.
  delete process.env.GRIST_ADMIN_EMAIL
  process.env.FIREBASE_API_KEY = "key"
  process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
  process.env.FIREBASE_PROJECT_ID = "grist-test"
  process.env.FIREBASE_APP_ID = "1:1:web:abc"
  const gateway = createGateway({
    fetch: async () =>
      new Response(JSON.stringify({ users: [{ localId: "uid_x", email: "founder@example.com" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  })
  const session = await call(gateway.fetch, "POST", "/v1/auth/session", {
    body: { id_token: "tok" },
  })
  expect((session.json as { admin: boolean }).admin).toBe(false)
  delete process.env.FIREBASE_API_KEY
  delete process.env.FIREBASE_AUTH_DOMAIN
  delete process.env.FIREBASE_PROJECT_ID
  delete process.env.FIREBASE_APP_ID
})

describe("invite codes", () => {
  test("canonicalizes separators and Crockford folds", () => {
    const code = generateInviteCode()
    expect(code).toMatch(/^grist-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(canonicalInviteCode(code.toLowerCase().replace("-", " "))).toBe(code)
    expect(canonicalInviteCode("grist-OI12-IL34")).toBe("grist-0112-1134")
    expect(canonicalInviteCode("nope")).toBeUndefined()
    const user = generateDeviceUserCode()
    expect(user).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(canonicalDeviceUserCode(user.toLowerCase())).toBe(user)
    const key = generateApiKeySecret()
    expect(key).toMatch(/^grist_sk_[0-9a-f]{64}$/)
    expect(canonicalApiKey(key.toUpperCase())).toBe(key)
    expect(canonicalApiKey("grist-ABCD-2345")).toBeUndefined()
  })
})

describe("metering", () => {
  const offPeak = Date.UTC(2026, 8, 21, 12, 0, 0)

  test("prices Flash tokens in USD", () => {
    expect(usdForUsage("deepseek/deepseek-v4.1-flash", 1_000_000, 0, { at: offPeak })).toBeCloseTo(0.15)
    expect(usdForUsage("moonshotai/kimi-k3", 1_000_000, 1_000_000, { at: offPeak })).toBeCloseTo(18)
    expect(usdForUsage("openai/gpt-6-sol", 0, 1_000_000, { at: offPeak })).toBeCloseTo(10)
    expect(usdForUsage("cheapest", 1_000_000, 0, { at: offPeak })).toBeCloseTo(0.15)
    expect(usdForUsage("medium", 1_000_000, 1_000_000, { at: offPeak })).toBeCloseTo(18)
    expect(usdForUsage("openrouter/frontier", 0, 1_000_000, { at: offPeak })).toBeCloseTo(10)
  })

  test("bills cached input tokens at the cached rate end to end", async () => {
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "or-test",
      typesafeKey: "",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 500,
              prompt_tokens_details: { cached_tokens: 900 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code
    const response = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": code },
      body: { model: "medium", messages: [], stream: false },
    })
    expect(response.status).toBe(200)
    // Kimi K3: 900 cached at 0.30/M + 100 fresh at 3/M + 500 output at 15/M = 0.00807.
    // Without the fix this bills 1000 fresh at 3/M = 0.0105.
    expect(gateway.store.getInvite(code)?.spent_usd).toBeCloseTo(0.00807, 5)
  })
})

describe("atomic spend cap", () => {
  test("applies debits only while the total stays within the cap", () => {
    const store = openGatewayStore()
    const invite = store.createInvite({ capUsd: 0.001 })
    const debit = (usd: number) =>
      store.addSpend({
        code: invite.code,
        model: "deepseek/deepseek-v4.1-flash",
        rung: "cheapest",
        inputTokens: 1000,
        outputTokens: 0,
        usd,
      })
    expect(debit(0.0005).spent_usd).toBeCloseTo(0.0005)
    expect(debit(0.0005).spent_usd).toBeCloseTo(0.001)
    // Would exceed the cap: rejected and clamped, never 0.0015.
    expect(debit(0.0005).spent_usd).toBeCloseTo(0.001)
    expect(store.getInvite(invite.code)?.spent_usd).toBeCloseTo(0.001)
    store.close()
  })
})

describe("one-time spend reset", () => {
  test("zeroes an invite's spend by code and reports the previous total", () => {
    const store = openGatewayStore()
    const invite = store.createInvite({ capUsd: 5 })
    store.addSpend({ code: invite.code, model: "m", rung: "cheapest", inputTokens: 1, outputTokens: 0, usd: 4 })
    expect(store.getInvite(invite.code)?.spent_usd).toBeCloseTo(4)
    const reset = store.resetSpend(invite.code)
    expect(reset?.previousUsd).toBeCloseTo(4)
    expect(store.getInvite(invite.code)?.spent_usd).toBe(0)
    expect(store.resetSpend("grist-0000-0000")).toBeUndefined()
    store.close()
  })

  test("resolves an API key to its invite", () => {
    const store = openGatewayStore()
    const invite = store.createInvite({ capUsd: 5 })
    const created = store.createApiKey({ inviteCode: invite.code, name: "reset-test" })
    store.addSpend({ code: invite.code, model: "m", rung: "cheapest", inputTokens: 1, outputTokens: 0, usd: 2 })
    const reset = store.resetSpend(created!.secret)
    expect(reset?.code).toBe(invite.code)
    expect(store.getInvite(invite.code)?.spent_usd).toBe(0)
    store.close()
  })

  test("runs once at gateway startup when GRIST_RESET_SPEND is set", () => {
    const store = openGatewayStore()
    const invite = store.createInvite({ capUsd: 5 })
    store.addSpend({ code: invite.code, model: "m", rung: "cheapest", inputTokens: 1, outputTokens: 0, usd: 3 })
    const alerts: string[] = []
    process.env.GRIST_RESET_SPEND = invite.code
    try {
      createGateway({ store, adminToken: "secret", alert: (message: string) => alerts.push(message) })
    } finally {
      delete process.env.GRIST_RESET_SPEND
    }
    expect(store.getInvite(invite.code)?.spent_usd).toBe(0)
    expect(alerts.some((message) => message.includes("one-time spend reset"))).toBe(true)
    expect(alerts.some((message) => message.includes(invite.code))).toBe(false)
    store.close()
  })
})

describe("api key last_used_at", () => {
  test("does not write last_used_at on every request", () => {
    const store = openGatewayStore()
    const invite = store.createInvite({ capUsd: 5 })
    const created = store.createApiKey({ inviteCode: invite.code, name: "muse" })
    expect(created).toBeDefined()
    const t0 = 1_700_000_000_000
    store.inviteForApiKey(created!.secret, t0)
    expect(store.listApiKeys(invite.code)[0]?.last_used_at).toBe(t0)
    store.inviteForApiKey(created!.secret, t0 + 1_000)
    expect(store.listApiKeys(invite.code)[0]?.last_used_at).toBe(t0)
    store.inviteForApiKey(created!.secret, t0 + 60_000)
    expect(store.listApiKeys(invite.code)[0]?.last_used_at).toBe(t0 + 60_000)
    store.close()
  })
})

describe("gateway HTTP", () => {
  test("validates, routes, caps, and revokes", async () => {
    const alerts: string[] = []
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "or-test",
      typesafeKey: "",
      globalBudgetUsd: 250,
      alert: (message) => alerts.push(message),
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1000, completion_tokens: 500 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })

    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 0.0001, note: "test" },
    })
    expect(minted.status).toBe(200)
    const code = (minted.json as { code: string }).code

    const valid = await call(gateway.fetch, "POST", "/v1/invite/validate", { body: { code } })
    expect((valid.json as { valid: boolean }).valid).toBe(true)

    const route = await call(gateway.fetch, "POST", "/v1/gate/route", {
      headers: { "X-Grist-Invite": code },
      body: { text: "Rename unused helper in src/graph/map.ts", session_id: "ses_test" },
    })
    expect(route.status).toBe(200)
    const decision = route.json as { rung: string; model: { model_id: string } }
    expect(decision.rung).toBe("cheapest")
    expect(decision.model.model_id).toBe("cheapest")
    expect(JSON.stringify(decision)).not.toContain("deepseek")

    const blocked = await call(gateway.fetch, "POST", "/v1/completions", {
      headers: { "X-Grist-Invite": code },
      body: { model: "gpt-4o", messages: [] },
    })
    expect(blocked.status).toBe(400)

    const ok = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": code },
      body: { model: "deepseek/deepseek-v4.1-flash", messages: [], stream: false },
    })
    expect(ok.status).toBe(200)
    expect((ok.json as { model: string }).model).toBe("cheapest")
    expect(JSON.stringify(ok.json)).not.toContain("deepseek")

    const usage = await call(gateway.fetch, "GET", "/v1/usage", {
      headers: { "X-Grist-Invite": code },
    })
    expect(usage.status).toBe(200)
    const spent = usage.json as {
      spent_usd: number
      remaining_usd: number
      plan: string
      expires_at: string
    }
    expect(spent.spent_usd).toBeGreaterThan(0)
    expect(spent.remaining_usd + spent.spent_usd).toBeCloseTo(0.0001)
    expect(spent.plan).toBe("beta")
    expect(spent.expires_at).toMatch(/^\d{4}-/)

    const cap = await call(gateway.fetch, "POST", "/v1/completions", {
      headers: { "X-Grist-Invite": code },
      body: { model: "deepseek/deepseek-v4.1-flash", messages: [] },
    })
    expect(cap.status).toBe(402)
    expect(String((cap.json as { error: string }).error)).toContain("Ask the founder")

    const revoked = await call(gateway.fetch, "DELETE", `/v1/admin/invites/${code}`, {
      headers: { "X-Grist-Admin": "secret" },
    })
    expect(revoked.status).toBe(200)

    const after = await call(gateway.fetch, "POST", "/v1/gate/route", {
      headers: { "X-Grist-Invite": code },
      body: { text: "hi" },
    })
    expect(after.status).toBe(401)

    const mode = await call(gateway.fetch, "POST", "/v1/admin/mode", {
      headers: { "X-Grist-Admin": "secret" },
      body: { mode: "capped" },
    })
    expect(mode.status).toBe(200)
    expect(gateway.store.getMode()).toBe("capped")

    void alerts
  })

  test("serves the landing page and keeps /health as JSON", async () => {
    const gateway = createGateway()
    const health = await gateway.fetch(new Request("http://gateway.test/health"))
    expect(health.headers.get("Content-Type")).toContain("application/json")
    expect(await health.json()).toEqual({ ok: true })

    const home = await gateway.fetch(new Request("http://gateway.test/"))
    expect(home.headers.get("Content-Type")).toContain("text/html")
    const html = await home.text()
    expect(html).not.toContain("Get access")
    expect(html).toContain("Sign in with Google")
    expect(html).toContain("npm install -g grist-ai")
    expect(html).toContain("Download for macOS")
    expect(html).not.toContain("tally.so")
    expect(html).toContain('id="request-form"')
    expect(html).toContain("Request access")
    expect(html).toContain('href="/privacy"')
    expect(html).toContain("Privacy Policy")
    expect(html).toContain("Terms of Use")
    expect(html).toContain("Acceptable Use Policy")
    expect(html).toContain("Cookie Policy")
    expect(html).toContain("learns your codebase")
    expect(html).toContain("SoL-Pi")
    expect(html).toContain("self-improves")
    expect(html).toContain('aria-label="Grist"')
    expect(html).toContain("M0 6H24V12H6V30H24V36H0V6")
    expect(html).toContain("/favicon.svg")
    expect(html).not.toContain("Apple Silicon")
    expect(html).not.toContain("Intel")
    expect(html).toContain("view-docs")
    expect(html).toContain("view-docs-skills")
    expect(html).toContain("Create key")
    expect(html).toContain("npx skills add grist-ai/grist-skills")
    expect(html).toContain("Read more")
    expect(html).not.toContain("Three steps")
    expect(html.toLowerCase()).not.toContain("deepseek")
    expect(html.toLowerCase()).not.toContain("kimi")
    expect(html.toLowerCase()).not.toContain("moonshot")
    expect(html.toLowerCase()).not.toContain("openrouter")
    expect(html.toLowerCase()).not.toContain("gpt-5")
    expect(html).not.toContain("Necora")
    expect(html).not.toContain("Pranav")
    expect(html).not.toContain("pranavmm25")
    expect(html).not.toContain("pranav6226")
    expect(html).toContain("admin@grist.lol")
    expect(html).not.toContain("privacy@grist.lol")

    const docs = await gateway.fetch(new Request("http://gateway.test/docs"))
    expect(docs.headers.get("Content-Type")).toContain("text/html")
    const docsHtml = await docs.text()
    expect(docsHtml).toContain("grist auth login")
    expect(docsHtml).toContain("npx skills add grist-ai/grist-skills")
    expect(docsHtml).toContain("id=\"agents\"")

    const skills = await gateway.fetch(new Request("http://gateway.test/docs/skills"))
    expect(await skills.text()).toContain("When to reach for Grist")

    const skillFile = await gateway.fetch(new Request("http://gateway.test/grist-skill.md"))
    expect(skillFile.headers.get("Content-Type")).toContain("text/markdown")
    const skillText = await skillFile.text()
    expect(skillText).toContain("Only run Grist on repos and machines you are allowed to modify.")
    expect(skillText).not.toContain("Necora")

    const wellKnown = await gateway.fetch(
      new Request("http://gateway.test/.well-known/agent-skills/grist/SKILL.md"),
    )
    expect(await wellKnown.text()).toBe(skillText)

    const index = await gateway.fetch(new Request("http://gateway.test/.well-known/agent-skills/index.json"))
    expect(index.headers.get("Content-Type")).toContain("application/json")
    const catalog = (await index.json()) as {
      skills: { name: string; type: string; url: string; digest: string }[]
    }
    expect(catalog.skills[0]?.name).toBe("grist")
    expect(catalog.skills[0]?.type).toBe("skill-md")
    expect(catalog.skills[0]?.url).toBe("/.well-known/agent-skills/grist/SKILL.md")
    expect(catalog.skills[0]?.digest).toMatch(/^sha256:[0-9a-f]{64}$/)

    const privacy = await gateway.fetch(new Request("http://gateway.test/privacy"))
    expect(privacy.status).toBe(200)
    const privacyHtml = await privacy.text()
    expect(privacyHtml).toContain("What we do not take")
    expect(privacyHtml.toLowerCase()).not.toContain("deepseek")
    expect(privacyHtml.toLowerCase()).not.toContain("kimi")
    expect(privacyHtml.toLowerCase()).not.toContain("moonshot")
    expect(privacyHtml.toLowerCase()).not.toContain("openrouter")
    expect(privacyHtml).not.toContain("Tally")

    const terms = await gateway.fetch(new Request("http://gateway.test/terms"))
    expect(await terms.text()).toContain("Invite-only beta")

    const aup = await gateway.fetch(new Request("http://gateway.test/acceptable-use"))
    expect(await aup.text()).toContain("Local execution")

    const cookies = await gateway.fetch(new Request("http://gateway.test/cookies"))
    const cookiesHtml = await cookies.text()
    expect(cookiesHtml).toContain("grist_invite")
    expect(cookiesHtml).not.toContain("Tally")

    const login = await gateway.fetch(new Request("http://gateway.test/login"))
    expect(await login.text()).toContain("Sign in")

    const adminPage = await gateway.fetch(new Request("http://gateway.test/admin"))
    const adminHtml = await adminPage.text()
    expect(adminHtml).toContain("Generate codes")
    expect(adminHtml).toContain('href="/admin/requests"')
    expect(adminHtml).toContain("Copy email")
    expect(adminHtml).toContain('path === "/admin"')
    expect(adminHtml).toContain("main.hidden = true")
    const appJs = await gateway.fetch(new Request("http://gateway.test/app.js"))
    const source = await appJs.text()
    expect(source).toContain("authStateReady")
    expect(source).toContain("if (ticket !== sessionTicket) return")

    const favicon = await gateway.fetch(new Request("http://gateway.test/favicon.svg"))
    expect(favicon.headers.get("Content-Type")).toContain("image/svg+xml")
    expect(await favicon.text()).toContain("M0 0H16V4H4V16H16V20H0V0")
  })

  test("binds a CLI login after the site approves the invite", async () => {
    const gateway = createGateway({ adminToken: "secret" })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { note: "cli" },
    })
    const code = (minted.json as { code: string }).code

    const started = await call(gateway.fetch, "POST", "/v1/auth/device")
    expect(started.status).toBe(200)
    const device = started.json as { device_code: string; user_code: string; verification_uri: string }
    expect(device.verification_uri).toBe(`/login?device=${device.user_code}`)

    const pending = await call(gateway.fetch, "POST", "/v1/auth/device/poll", {
      body: { device_code: device.device_code },
    })
    expect((pending.json as { status: string }).status).toBe("pending")

    const approved = await call(gateway.fetch, "POST", "/v1/auth/device/approve", {
      body: { user_code: device.user_code, code },
    })
    expect((approved.json as { ok: boolean }).ok).toBe(true)

    const done = await call(gateway.fetch, "POST", "/v1/auth/device/poll", {
      body: { device_code: device.device_code },
    })
    expect(done.json).toEqual({ status: "approved", code })

    const again = await call(gateway.fetch, "POST", "/v1/auth/device/poll", {
      body: { device_code: device.device_code },
    })
    expect(again.status).toBe(401)
  })

  test("exposes firebase config and binds a uid to an invite", async () => {
    process.env.FIREBASE_API_KEY = "test-key"
    process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
    process.env.FIREBASE_PROJECT_ID = "grist-test"
    process.env.FIREBASE_APP_ID = "1:1:web:abc"
    const gateway = createGateway({
      adminToken: "secret",
      fetch: async () =>
        new Response(JSON.stringify({ users: [{ localId: "uid_1", email: "a@b.co" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    })
    const config = await call(gateway.fetch, "GET", "/v1/auth/config")
    expect((config.json as { enabled: boolean }).enabled).toBe(true)

    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { note: "fb" },
    })
    const code = (minted.json as { code: string }).code
    const session = await call(gateway.fetch, "POST", "/v1/auth/session", {
      body: { id_token: "tok" },
    })
    expect((session.json as { needs_invite: boolean }).needs_invite).toBe(true)

    const bound = await call(gateway.fetch, "POST", "/v1/auth/session/bind", {
      body: { id_token: "tok", code },
    })
    expect((bound.json as { ok: boolean; code: string }).ok).toBe(true)
    expect((bound.json as { code: string }).code).toBe(code)

    const again = await call(gateway.fetch, "POST", "/v1/auth/session", {
      body: { id_token: "tok" },
    })
    expect((again.json as { needs_invite: boolean }).needs_invite).toBe(false)
    expect((again.json as { code: string }).code).toBe(code)

    const usage = await call(gateway.fetch, "GET", "/v1/usage", {
      headers: { Authorization: "Bearer tok" },
    })
    expect(usage.status).toBe(200)
    delete process.env.FIREBASE_API_KEY
    delete process.env.FIREBASE_AUTH_DOMAIN
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_APP_ID
  })

  test("single-use binding: 409 on taken code, 400 on rebind, idempotent retry", async () => {
    process.env.FIREBASE_API_KEY = "test-key"
    process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
    process.env.FIREBASE_PROJECT_ID = "grist-test"
    process.env.FIREBASE_APP_ID = "1:1:web:abc"
    const gateway = createGateway({
      adminToken: "secret",
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { idToken?: string }
        const n = body.idToken === "tok-b" ? "b" : "a"
        return new Response(
          JSON.stringify({ users: [{ localId: `uid_${n}`, email: `${n}@x.co` }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      },
    })
    const mint = async () =>
      (await call(gateway.fetch, "POST", "/v1/admin/invites", {
        headers: { "X-Grist-Admin": "secret" },
        body: {},
      })).json as { code: string }
    const bind = (idToken: string, code: string) =>
      call(gateway.fetch, "POST", "/v1/auth/session/bind", { body: { id_token: idToken, code } })

    const code1 = (await mint()).code
    const code2 = (await mint()).code

    // First bind wins.
    expect(((await bind("tok-a", code1)).json as { ok: boolean }).ok).toBe(true)
    // Idempotent retry: same account + same code is fine.
    const retry = await bind("tok-a", code1)
    expect(retry.status).toBe(200)
    expect((retry.json as { ok: boolean }).ok).toBe(true)
    // Second account on the same code: 409, not a 500.
    const taken = await bind("tok-b", code1)
    expect(taken.status).toBe(409)
    expect((taken.json as { ok: boolean }).ok).toBe(false)
    // Same account trying a different code: 400.
    const rebind = await bind("tok-a", code2)
    expect(rebind.status).toBe(400)
    expect((rebind.json as { ok: boolean }).ok).toBe(false)

    delete process.env.FIREBASE_API_KEY
    delete process.env.FIREBASE_AUTH_DOMAIN
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_APP_ID
  })

  test("binding revokes the account's other unclaimed request codes", async () => {
    process.env.FIREBASE_API_KEY = "test-key"
    process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
    process.env.FIREBASE_PROJECT_ID = "grist-test"
    process.env.FIREBASE_APP_ID = "1:1:web:abc"
    const gateway = createGateway({
      adminToken: "secret",
      fetch: async () =>
        new Response(JSON.stringify({ users: [{ localId: "uid_s", email: "sib@x.co" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    })
    const adminHeaders = { "X-Grist-Admin": "secret" }
    const requestCode = async () => {
      await call(gateway.fetch, "POST", "/v1/access/requests", {
        body: { email: "sib@x.co", name: "Sib" },
      })
      const listed = await call(gateway.fetch, "GET", "/v1/admin/requests", {
        headers: adminHeaders,
      })
      const requests = (listed.json as { requests: { id: string; status: string }[] }).requests
      const open = requests.find((r) => r.status === "open")
      const minted = await call(gateway.fetch, "POST", `/v1/admin/requests/${open?.id}/code`, {
        headers: adminHeaders,
      })
      const code = (minted.json as { code: string }).code
      // Mark sent so a later request for the same email opens a fresh row.
      await call(gateway.fetch, "POST", `/v1/admin/requests/${open?.id}/sent`, {
        headers: adminHeaders,
      })
      return code
    }
    // Two separate requests for the same email -> two request-linked codes.
    const code1 = await requestCode()
    const code2 = await requestCode()
    expect(code1).not.toBe(code2)

    const bound = await call(gateway.fetch, "POST", "/v1/auth/session/bind", {
      body: { id_token: "tok", code: code1 },
    })
    expect((bound.json as { ok: boolean }).ok).toBe(true)
    // Bound code stays usable; the sibling spare is revoked (single-use).
    expect(gateway.store.getInvite(code1)?.revoked).toBe(0)
    expect(gateway.store.getInvite(code2)?.revoked).toBe(1)

    delete process.env.FIREBASE_API_KEY
    delete process.env.FIREBASE_AUTH_DOMAIN
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_APP_ID
  })

  test("rejects codes that were never minted", async () => {
    const gateway = createGateway({ adminToken: "secret" })
    const valid = await call(gateway.fetch, "POST", "/v1/invite/validate", {
      body: { code: generateInviteCode() },
    })
    expect((valid.json as { valid: boolean }).valid).toBe(false)
  })

  test("requires the admin token for admin endpoints, always", async () => {
    process.env.FIREBASE_API_KEY = "test-key"
    process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
    process.env.FIREBASE_PROJECT_ID = "grist-test"
    process.env.FIREBASE_APP_ID = "1:1:web:abc"
    const gateway = createGateway({
      adminToken: "secret",
      adminEmail: "pranavmm25@gmail.com",
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { idToken?: string }
        const email = body.idToken === "admin-tok" ? "pranavmm25@gmail.com" : "tester@beta"
        const localId = body.idToken === "admin-tok" ? "uid_admin" : "uid_tester"
        return new Response(JSON.stringify({ users: [{ localId, email }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      },
    })

    const testerMint = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { Authorization: "Bearer tester-tok" },
      body: { note: "nope" },
    })
    expect(testerMint.status).toBe(401)

    // A Firebase session for the admin email alone is NOT sufficient.
    const firebaseOnly = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { Authorization: "Bearer admin-tok" },
      body: { note: "nope" },
    })
    expect(firebaseOnly.status).toBe(401)

    const session = await call(gateway.fetch, "POST", "/v1/auth/session", {
      body: { id_token: "admin-tok" },
    })
    const adminSession = session.json as { admin: boolean; needs_invite: boolean; code: string }
    expect(adminSession.admin).toBe(true)
    expect(adminSession.needs_invite).toBe(false)
    expect(adminSession.code).toMatch(/^grist-/)

    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { count: 2, cap_usd: 5, note: "beta" },
    })
    expect(minted.status).toBe(200)
    const codes = (minted.json as { codes: string[] }).codes
    expect(codes).toHaveLength(2)

    const listed = await call(gateway.fetch, "GET", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
    })
    expect(listed.status).toBe(200)
    const overview = listed.json as { invites: { code: string; note: string | null }[] }
    expect(overview.invites.some((row) => row.code === codes[0] && row.note === "beta")).toBe(true)

    const tester = await call(gateway.fetch, "POST", "/v1/auth/session", {
      body: { id_token: "tester-tok" },
    })
    expect((tester.json as { admin: boolean; needs_invite: boolean }).admin).toBe(false)
    expect((tester.json as { needs_invite: boolean }).needs_invite).toBe(true)

    delete process.env.FIREBASE_API_KEY
    delete process.env.FIREBASE_AUTH_DOMAIN
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_APP_ID
  })

  test("serves the Apple Silicon dmg from /download", async () => {
    const root = path.join(os.tmpdir(), `grist-site-${crypto.randomUUID()}`)
    await Bun.write(path.join(root, "download", "grist-desktop-mac-arm64.dmg"), "dmg-bytes")
    const gateway = createGateway({ siteRoot: root })
    const found = await gateway.fetch(new Request("http://gateway.test/download/grist-desktop-mac-arm64.dmg"))
    expect(found.status).toBe(200)
    expect(found.headers.get("content-type")).toBe("application/x-apple-diskimage")
    expect(await found.text()).toBe("dmg-bytes")
    const blocked = await gateway.fetch(new Request("http://gateway.test/download/../index.html"))
    expect(blocked.status).toBe(404)
    const missingRoot = path.join(os.tmpdir(), `grist-site-${crypto.randomUUID()}`)
    const redirect = await createGateway({ siteRoot: missingRoot }).fetch(
      new Request("http://gateway.test/download/grist-desktop-mac-arm64.dmg"),
    )
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get("location")).toContain("grist-downloads")
  })

  test("mints agent API keys that spend against the invite", async () => {
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "or-test",
      typesafeKey: "",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1000, completion_tokens: 500 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5, note: "keys" },
    })
    const code = (minted.json as { code: string }).code

    const denied = await call(gateway.fetch, "POST", "/v1/api-keys", {
      body: { name: "muse-vm" },
    })
    expect(denied.status).toBe(401)

    const created = await call(gateway.fetch, "POST", "/v1/api-keys", {
      headers: { "X-Grist-Invite": code },
      body: { name: "muse-vm" },
    })
    expect(created.status).toBe(200)
    const createdBody = created.json as { key: string; id: string; prefix: string; name: string }
    expect(createdBody.name).toBe("muse-vm")
    expect(createdBody.key).toMatch(/^grist_sk_[0-9a-f]{64}$/)
    expect(createdBody.prefix).toBe(`${createdBody.key.slice(0, 16)}…`)

    const listed = await call(gateway.fetch, "GET", "/v1/api-keys", {
      headers: { "X-Grist-Invite": code },
    })
    expect((listed.json as { keys: { id: string }[] }).keys.some((row) => row.id === createdBody.id)).toBe(true)
    expect(JSON.stringify(listed.json)).not.toContain(createdBody.key)

    const viaHeader = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Api-Key": createdBody.key },
      body: { model: "deepseek/deepseek-v4.1-flash", messages: [], stream: false },
    })
    expect(viaHeader.status).toBe(200)

    const viaBearer = await call(gateway.fetch, "GET", "/v1/usage", {
      headers: { Authorization: `Bearer ${createdBody.key}` },
    })
    expect(viaBearer.status).toBe(200)
    expect((viaBearer.json as { spent_usd: number }).spent_usd).toBeGreaterThan(0)

    const mintWithKey = await call(gateway.fetch, "POST", "/v1/api-keys", {
      headers: { "X-Grist-Api-Key": createdBody.key },
      body: { name: "nope" },
    })
    expect(mintWithKey.status).toBe(401)

    const revoked = await call(gateway.fetch, "DELETE", `/v1/api-keys/${createdBody.id}`, {
      headers: { "X-Grist-Invite": code },
    })
    expect(revoked.status).toBe(200)

    const after = await call(gateway.fetch, "POST", "/v1/gate/route", {
      headers: { "X-Grist-Api-Key": createdBody.key },
      body: { text: "hi" },
    })
    expect(after.status).toBe(401)
  })

  test("logs gateway auth time separately from upstream fetch time", async () => {
    const lines: string[] = []
    const orig = console.info
    console.info = (...args: unknown[]) => {
      if (typeof args[0] === "string") lines.push(args[0])
    }
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "or-test",
      typesafeKey: "",
      fetch: async () => {
        await Bun.sleep(25)
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200, headers: { "x-openrouter-provider": "DeepSeek" } },
        )
      },
    })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code
    await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": code },
      body: { model: "deepseek/deepseek-v4.1-flash", messages: [], stream: false },
    })
    console.info = orig
    const log = lines.find((line) => line.includes("completions rung="))
    expect(log).toContain("auth_ms=")
    expect(log).toContain("upstream_ms=")
    expect(log).toContain("rung=cheapest")
    expect(log).toContain("cache_hit=")
    expect(log).not.toContain("DeepSeek")
    expect(log).not.toContain("deepseek")
    const upstreamMs = Number(log?.match(/upstream_ms=(\d+)/)?.[1])
    expect(upstreamMs).toBeGreaterThanOrEqual(20)
  })

  test("capped mode blocks frontier completions and allows cheapest", async () => {
    const forwarded: string[] = []
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "or-test",
      typesafeKey: "",
      fetch: async (_input, init) => {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { model?: string }
        forwarded.push(payload.model ?? "")
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1000, completion_tokens: 500 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      },
    })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code
    const mode = await call(gateway.fetch, "POST", "/v1/admin/mode", {
      headers: { "X-Grist-Admin": "secret" },
      body: { mode: "capped" },
    })
    expect(mode.status).toBe(200)

    const frontier = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": code },
      body: { model: "frontier", messages: [], stream: false },
    })
    expect(frontier.status).toBe(200)
    expect(forwarded[0]).toBe(RUNG_MODELS.medium.modelID)
    expect(forwarded[0]).not.toBe(RUNG_MODELS.frontier.modelID)

    const cheapest = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": code },
      body: { model: "cheapest", messages: [], stream: false },
    })
    expect(cheapest.status).toBe(200)
    expect(forwarded[1]).toBe(RUNG_MODELS.cheapest.modelID)
  })

  test("whitelists upstream fields and clamps max_tokens", async () => {
    const forwarded: Record<string, unknown>[] = []
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "or-test",
      typesafeKey: "",
      fetch: async (_input, init) => {
        forwarded.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>)
        return new Response(JSON.stringify({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      },
    })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code
    const response = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": code },
      body: {
        model: "cheapest",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.2,
        provider: { order: ["MostExpensive"] },
        models: ["expensive/model"],
        reasoning: { effort: "high" },
        plugins: [{ id: "web" }],
        max_tokens: MAX_COMPLETION_TOKENS * 10,
        stream: false,
      },
    })
    expect(response.status).toBe(200)
    const payload = forwarded[0]!
    expect(payload.model).toBe(RUNG_MODELS.cheapest.modelID)
    expect(payload.messages).toBeDefined()
    expect(payload.temperature).toBe(0.2)
    expect(payload.max_tokens).toBe(MAX_COMPLETION_TOKENS)
    expect("provider" in payload).toBe(false)
    expect("models" in payload).toBe(false)
    expect("reasoning" in payload).toBe(false)
    expect("plugins" in payload).toBe(false)
  })

  test("forwards nested cache_control on messages and tools", async () => {
    const forwarded: Record<string, unknown>[] = []
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "or-test",
      typesafeKey: "",
      fetch: async (_input, init) => {
        forwarded.push(JSON.parse(String(init?.body ?? "{}")))
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })
      },
    })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code
    const cache = { type: "ephemeral" }
    await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": code },
      body: {
        model: "cheapest",
        messages: [
          { role: "system", content: "identity", cache_control: cache },
          { role: "system", content: "setup date", cache_control: cache },
          { role: "user", content: "hi" },
        ],
        tools: [{ type: "function", function: { name: "read" }, cache_control: cache }],
        stream: false,
      },
    })
    const payload = forwarded[0]!
    expect(payload.messages).toEqual([
      { role: "system", content: "identity", cache_control: cache },
      { role: "system", content: "setup date", cache_control: cache },
      { role: "user", content: "hi" },
    ])
    expect(payload.tools).toEqual([{ type: "function", function: { name: "read" }, cache_control: cache }])
  })

  test("strips vendor model ids from streamed completions", async () => {
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "or-test",
      typesafeKey: "",
      fetch: async () =>
        new Response(
          [
            `data: ${JSON.stringify({ model: "deepseek/deepseek-v4.1-flash", choices: [{ delta: { content: "hi" } }] })}\n\n`,
            `data: ${JSON.stringify({ model: "deepseek/deepseek-v4.1-flash", usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`,
            "data: [DONE]\n\n",
          ].join(""),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code
    const response = await gateway.fetch(
      new Request("http://gateway.test/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Grist-Invite": code },
        body: JSON.stringify({ model: "cheapest", messages: [], stream: true }),
      }),
    )
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text.toLowerCase()).not.toContain("deepseek")
    expect(text).toContain("cheapest")
  })

  test("keeps access requests for the admin to mint and send", async () => {
    const gateway = createGateway({ adminToken: "secret" })
    const bad = await call(gateway.fetch, "POST", "/v1/access/requests", { body: { email: "nope" } })
    expect(bad.status).toBe(400)

    const created = await call(gateway.fetch, "POST", "/v1/access/requests", {
      body: { email: "Ada@Example.com", name: "Ada", note: "a compiler" },
    })
    expect(created.status).toBe(200)

    const again = await call(gateway.fetch, "POST", "/v1/access/requests", {
      body: { email: "ada@example.com", name: "Ada again" },
    })
    expect(again.status).toBe(200)

    const denied = await call(gateway.fetch, "GET", "/v1/admin/requests")
    expect(denied.status).toBe(401)

    const listed = await call(gateway.fetch, "GET", "/v1/admin/requests", {
      headers: { "X-Grist-Admin": "secret" },
    })
    expect(listed.status).toBe(200)
    const requests = (listed.json as { requests: { id: string; email: string; name: string; status: string }[] }).requests
    expect(requests).toHaveLength(1)
    expect(requests[0]?.email).toBe("ada@example.com")
    expect(requests[0]?.name).toBe("Ada")
    expect(requests[0]?.status).toBe("open")

    const minted = await call(gateway.fetch, "POST", `/v1/admin/requests/${requests[0]?.id}/code`, {
      headers: { "X-Grist-Admin": "secret" },
    })
    expect(minted.status).toBe(200)
    const mintedBody = minted.json as { code: string; cap_usd: number; days: number; email: string }
    const code = mintedBody.code
    expect(code).toMatch(/^grist-/)
    expect(mintedBody.email).toBe("ada@example.com")
    expect(mintedBody.cap_usd).toBe(5)
    expect(mintedBody.days).toBe(30)

    const second = await call(gateway.fetch, "POST", `/v1/admin/requests/${requests[0]?.id}/code`, {
      headers: { "X-Grist-Admin": "secret" },
    })
    expect((second.json as { code: string }).code).toBe(code)

    const usable = await call(gateway.fetch, "POST", "/v1/invite/validate", { body: { code } })
    expect((usable.json as { valid: boolean }).valid).toBe(true)

    const sent = await call(gateway.fetch, "POST", `/v1/admin/requests/${requests[0]?.id}/sent`, {
      headers: { "X-Grist-Admin": "secret" },
    })
    expect(sent.status).toBe(200)

    const after = await call(gateway.fetch, "GET", "/v1/admin/requests", {
      headers: { "X-Grist-Admin": "secret" },
    })
    const row = (after.json as { requests: { status: string; code: string }[] }).requests[0]
    expect(row?.status).toBe("sent")
    expect(row?.code).toBe(code)
  })

  test("rate-limits gate/route per account", async () => {
    const gateway = createGateway({ adminToken: "secret", typesafeKey: "" })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code

    for (let i = 0; i < 30; i++) {
      const ok = await call(gateway.fetch, "POST", "/v1/gate/route", {
        headers: { "X-Grist-Invite": code },
        body: { text: "rename a helper" },
      })
      expect(ok.status).toBe(200)
    }

    const limited = await call(gateway.fetch, "POST", "/v1/gate/route", {
      headers: { "X-Grist-Invite": code },
      body: { text: "rename a helper" },
    })
    expect(limited.status).toBe(429)
  })

  test("rate-limits api key minting per account", async () => {
    const gateway = createGateway({ adminToken: "secret" })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code

    for (let i = 0; i < 10; i++) {
      const ok = await call(gateway.fetch, "POST", "/v1/api-keys", {
        headers: { "X-Grist-Invite": code },
        body: { name: `key-${i}` },
      })
      expect(ok.status).toBe(200)
    }

    const limited = await call(gateway.fetch, "POST", "/v1/api-keys", {
      headers: { "X-Grist-Invite": code },
      body: { name: "one-too-many" },
    })
    expect(limited.status).toBe(429)
  })

  test("rate-limits completions per account", async () => {
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "or-test",
      rateLimits: { completions: { limit: 2, windowMs: 60_000 } },
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code

    for (let i = 0; i < 2; i++) {
      const ok = await call(gateway.fetch, "POST", "/v1/completions", {
        headers: { "X-Grist-Invite": code },
        body: { model: "deepseek/deepseek-v4.1-flash", messages: [] },
      })
      expect(ok.status).toBe(200)
    }

    const limited = await call(gateway.fetch, "POST", "/v1/completions", {
      headers: { "X-Grist-Invite": code },
      body: { model: "deepseek/deepseek-v4.1-flash", messages: [] },
    })
    expect(limited.status).toBe(429)
  })

  test("rate-limits device flow start per IP", async () => {
    const gateway = createGateway({})
    for (let i = 0; i < 10; i++) {
      const ok = await call(gateway.fetch, "POST", "/v1/auth/device", {})
      expect(ok.status).toBe(200)
    }
    const limited = await call(gateway.fetch, "POST", "/v1/auth/device", {})
    expect(limited.status).toBe(429)
  })

  test("trusts X-Forwarded-For only from private peers", async () => {
    const gateway = createGateway({})
    const headers = { "X-Forwarded-For": "9.9.9.9" }
    // Private peer (edge proxy): XFF trusted, bucket keyed by 9.9.9.9.
    for (let i = 0; i < 10; i++) {
      const ok = await call(gateway.fetch, "POST", "/v1/auth/device", { headers, peerIp: "10.0.0.5" })
      expect(ok.status).toBe(200)
    }
    // Same client IP via a direct connection shares the exhausted bucket.
    const viaDirect = await call(gateway.fetch, "POST", "/v1/auth/device", { peerIp: "9.9.9.9" })
    expect(viaDirect.status).toBe(429)
  })

  test("alerts on invite fingerprint, never the code", async () => {
    const alerts: string[] = []
    const gateway = createGateway({
      adminToken: "secret",
      openrouterKey: "or-test",
      alert: (message) => alerts.push(message),
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 50 },
    })
    const code = (minted.json as { code: string }).code
    // Push hourly spend over the $2 abuse threshold.
    gateway.store.addSpend({ code, model: "test", rung: "cheapest", inputTokens: 0, outputTokens: 0, usd: 3 })
    const ok = await call(gateway.fetch, "POST", "/v1/completions", {
      headers: { "X-Grist-Invite": code },
      body: { model: "deepseek/deepseek-v4.1-flash", messages: [] },
    })
    expect(ok.status).toBe(200)
    expect(alerts).toHaveLength(1)
    const fingerprint = createHash("sha256").update(code).digest("hex").slice(0, 12)
    expect(alerts[0]).toContain(fingerprint)
    expect(alerts[0]).not.toContain(code)
  })

  test("ignores spoofed X-Forwarded-For from public peers", async () => {
    const gateway = createGateway({})
    const headers = { "X-Forwarded-For": "9.9.9.9" }
    // Public peer: XFF ignored, bucket keyed by the peer 203.0.113.7.
    for (let i = 0; i < 10; i++) {
      const ok = await call(gateway.fetch, "POST", "/v1/auth/device", { headers, peerIp: "203.0.113.7" })
      expect(ok.status).toBe(200)
    }
    const limited = await call(gateway.fetch, "POST", "/v1/auth/device", { headers, peerIp: "203.0.113.7" })
    expect(limited.status).toBe(429)
    // The spoofed identity was never counted: fresh bucket.
    const fresh = await call(gateway.fetch, "POST", "/v1/auth/device", { peerIp: "9.9.9.9" })
    expect(fresh.status).toBe(200)
  })

  test("trusts X-Forwarded-For from configured proxy CIDRs", async () => {
    const gateway = createGateway({ trustedProxies: "203.0.113.0/24" })
    const headers = { "X-Forwarded-For": "9.9.9.9" }
    for (let i = 0; i < 10; i++) {
      const ok = await call(gateway.fetch, "POST", "/v1/auth/device", { headers, peerIp: "203.0.113.7" })
      expect(ok.status).toBe(200)
    }
    const viaDirect = await call(gateway.fetch, "POST", "/v1/auth/device", { peerIp: "9.9.9.9" })
    expect(viaDirect.status).toBe(429)
  })

  test("meters Jev scoring and leaves shadow scoring free", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: {
            difficulty: { type: "score", score: 2 },
            sensitivity: { type: "score", score: 1 },
            underspecified: { type: "noul", noul: 0.1 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch
    try {
      const gateway = createGateway({ adminToken: "secret", typesafeKey: "ts-test" })
      const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
        headers: { "X-Grist-Admin": "secret" },
        body: { cap_usd: 5 },
      })
      const code = (minted.json as { code: string }).code

      const route = await call(gateway.fetch, "POST", "/v1/gate/route", {
        headers: { "X-Grist-Invite": code },
        body: { text: "refactor auth across files" },
      })
      expect(route.status).toBe(200)
      expect((route.json as { provider: string }).provider).toBe("jev")
      expect(gateway.store.usageFor(code).some((event) => event.model === "gate/route")).toBe(true)
      expect(gateway.store.getInvite(code)?.spent_usd).toBeCloseTo(0.0003)
    } finally {
      globalThis.fetch = originalFetch
    }

    const shadow = createGateway({ adminToken: "secret", typesafeKey: "" })
    const minted = await call(shadow.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code
    const route = await call(shadow.fetch, "POST", "/v1/gate/route", {
      headers: { "X-Grist-Invite": code },
      body: { text: "refactor auth across files" },
    })
    expect((route.json as { provider: string }).provider).toBe("shadow")
    expect(shadow.store.usageFor(code)).toHaveLength(0)
    expect(shadow.store.getInvite(code)?.spent_usd).toBe(0)
  })

  test("rejects oversized request bodies with 413", async () => {
    const gateway = createGateway({ adminToken: "secret", typesafeKey: "" })
    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { "X-Grist-Admin": "secret" },
      body: { cap_usd: 5 },
    })
    const code = (minted.json as { code: string }).code

    const gate = await call(gateway.fetch, "POST", "/v1/gate/route", {
      headers: { "X-Grist-Invite": code },
      body: { text: "x".repeat(9 * 1024) },
    })
    expect(gate.status).toBe(413)

    const completions = await call(gateway.fetch, "POST", "/v1/chat/completions", {
      headers: { "X-Grist-Invite": code },
      body: { model: "cheapest", messages: [{ role: "user", content: "x".repeat(257 * 1024) }] },
    })
    expect(completions.status).toBe(413)
  })
})

async function call(
  fetch: (req: Request, peerIp?: string) => Promise<Response>,
  method: string,
  path: string,
  input?: { headers?: Record<string, string>; body?: unknown; peerIp?: string },
) {
  const response = await fetch(
    new Request(`http://gateway.test${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...input?.headers,
      },
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(input?.body ?? {}),
    }),
    input?.peerIp,
  )
  const text = await response.text()
  return {
    status: response.status,
    json: text ? JSON.parse(text) : undefined,
  }
}
