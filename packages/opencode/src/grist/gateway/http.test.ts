import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { canonicalApiKey, canonicalDeviceUserCode, canonicalInviteCode, generateApiKeySecret, generateDeviceUserCode, generateInviteCode } from "./codes"
import { usdForUsage } from "./prices"
import { createGateway } from "./http"

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
  test("prices Flash tokens in USD", () => {
    expect(usdForUsage("deepseek/deepseek-v4.1-flash", 1_000_000, 0)).toBeCloseTo(0.15)
    expect(usdForUsage("openai/gpt-5.6-sol", 0, 1_000_000)).toBeCloseTo(10)
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
    expect(decision.model.model_id).toBe("deepseek/deepseek-v4.1-flash")

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
    expect(html).toContain("tally.so/embed/QKGWYG")
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
    expect(html).not.toContain("Three steps")
    expect(html).not.toContain("deepseek")
    expect(html).not.toContain("kimi")
    expect(html).not.toContain("gpt-5")

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
    expect(skillText).toContain("Never run Grist on Necora")

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
    expect(await privacy.text()).toContain("What we do not take")

    const terms = await gateway.fetch(new Request("http://gateway.test/terms"))
    expect(await terms.text()).toContain("Invite-only beta")

    const aup = await gateway.fetch(new Request("http://gateway.test/acceptable-use"))
    expect(await aup.text()).toContain("Local execution")

    const cookies = await gateway.fetch(new Request("http://gateway.test/cookies"))
    expect(await cookies.text()).toContain("grist_invite")

    const login = await gateway.fetch(new Request("http://gateway.test/login"))
    expect(await login.text()).toContain("Sign in")

    const adminPage = await gateway.fetch(new Request("http://gateway.test/admin"))
    expect(await adminPage.text()).toContain("Generate codes")

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

  test("rejects codes that were never minted", async () => {
    const gateway = createGateway({ adminToken: "secret" })
    const valid = await call(gateway.fetch, "POST", "/v1/invite/validate", {
      body: { code: generateInviteCode() },
    })
    expect((valid.json as { valid: boolean }).valid).toBe(false)
  })

  test("lets only the admin email mint and list codes", async () => {
    process.env.FIREBASE_API_KEY = "test-key"
    process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
    process.env.FIREBASE_PROJECT_ID = "grist-test"
    process.env.FIREBASE_APP_ID = "1:1:web:abc"
    const gateway = createGateway({
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

    const session = await call(gateway.fetch, "POST", "/v1/auth/session", {
      body: { id_token: "admin-tok" },
    })
    const adminSession = session.json as { admin: boolean; needs_invite: boolean; code: string }
    expect(adminSession.admin).toBe(true)
    expect(adminSession.needs_invite).toBe(false)
    expect(adminSession.code).toMatch(/^grist-/)

    const minted = await call(gateway.fetch, "POST", "/v1/admin/invites", {
      headers: { Authorization: "Bearer admin-tok" },
      body: { count: 2, cap_usd: 5, note: "beta" },
    })
    expect(minted.status).toBe(200)
    const codes = (minted.json as { codes: string[] }).codes
    expect(codes).toHaveLength(2)

    const listed = await call(gateway.fetch, "GET", "/v1/admin/invites", {
      headers: { Authorization: "Bearer admin-tok" },
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
})

async function call(
  fetch: (req: Request) => Promise<Response>,
  method: string,
  path: string,
  input?: { headers?: Record<string, string>; body?: unknown },
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
  )
  const text = await response.text()
  return {
    status: response.status,
    json: text ? JSON.parse(text) : undefined,
  }
}
