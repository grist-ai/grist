import path from "path"
import { createHash } from "node:crypto"
import { composeMechanisms, loadMechanismProfile } from "../mechanisms"
import { composeRung, scoreTask } from "../jev-gate"
import { publicModelRef } from "../rung"
import { typesafeKey } from "../jev-client"
import { applyModeCap, type OperatingMode } from "../mode"
import { firebasePublicConfig, verifyFirebaseIdToken, type FirebaseUser } from "./firebase"
import { isLadderModel, publicLadderID, upstreamLadderID, priceForModel, usdForUsage } from "./prices"
import { openGatewayStore, type GatewayStore, type InviteRow } from "./store"
import { canonicalApiKey } from "./codes"

export type GatewayOptions = {
  store?: GatewayStore
  dbPath?: string
  openrouterKey?: string
  typesafeKey?: string
  adminToken?: string
  adminEmail?: string
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  now?: () => number
  alert?: (message: string) => void
  globalBudgetUsd?: number
  siteRoot?: string
  /** Comma-separated IPs/CIDRs allowed to set X-Forwarded-For; see clientIp. */
  trustedProxies?: string
  /** Test hook: override rate-limit windows without hammering the defaults. */
  rateLimits?: Partial<Record<"validate" | "keyMint" | "completions" | "deviceStart" | "gateRoute", { limit: number; windowMs: number }>>
}

/** An invite plus the API key that authenticated the request, when one did. */
type ResolvedInvite = InviteRow & { keyId: string | null }

const SITE_ROOT = path.join(import.meta.dir, "..", "site")
const SITE_PAGES = new Set([
  "/",
  "/login",
  "/dashboard",
  "/dashboard/api",
  "/plans",
  "/admin",
  "/admin/requests",
  "/docs",
  "/docs/skills",
  "/privacy",
  "/terms",
  "/acceptable-use",
  "/cookies",
])
const SITE_FILES: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "favicon.svg": "image/svg+xml",
  "favicon-32.png": "image/png",
  "apple-touch-icon.png": "image/png",
}
const MAC_DMG = /^\/download\/(grist-desktop-mac-(arm64|x64)\.dmg)$/
const PUBLIC_MAC_DMGS: Record<string, string> = {
  "grist-desktop-mac-arm64.dmg":
    "https://github.com/pranav6226/grist-downloads/releases/latest/download/grist-desktop-mac-arm64.dmg",
}

/**
 * Rate-limit windows. `validate` guards the invite/device/access-request
 * endpoints per IP; `keyMint` caps API key creation per account (spec:
 * 10/hr); `completions` bounds the money path per account on top of spend
 * caps; `deviceStart` throttles device-flow initiation per IP; `gateRoute`
 * bounds Jev scoring calls per account.
 */
const RATE_LIMITS = {
  validate: { limit: 10, windowMs: 60_000 },
  keyMint: { limit: 10, windowMs: 3_600_000 },
  completions: { limit: 300, windowMs: 10 * 60_000 },
  deviceStart: { limit: 10, windowMs: 60_000 },
  gateRoute: { limit: 30, windowMs: 60_000 },
}
/**
 * Flat debit per Jev `scoreTask` call. Jev bills per request rather than per
 * token, so the gateway charges a small fixed amount when it actually reaches
 * the paid provider (shadow scoring stays free). Tune from the TypeSafe invoice.
 */
const GATE_ROUTE_COST_USD = 0.0003
const MAX_JSON_BYTES = 256 * 1024
const MAX_GATE_BYTES = 8 * 1024
const HOURLY_ABUSE_USD = 2
const DEFAULT_GLOBAL_BUDGET = 250
const DEVICE_TTL_MS = 10 * 60 * 1000

/**
 * Fields the gateway forwards upstream. Everything else is dropped so clients
 * cannot smuggle `provider`, `models`, `reasoning`, or `plugins` and shift
 * spend onto providers/paths the metered ladder price does not cover.
 */
const UPSTREAM_FIELDS = [
  "messages",
  "temperature",
  "top_p",
  "stop",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "response_format",
  "seed",
  "presence_penalty",
  "frequency_penalty",
] as const

/** Hard ceiling on generated tokens per completion, regardless of request. */
export const MAX_COMPLETION_TOKENS = 8192

/** Thrown by `readJson` when a request body exceeds its endpoint cap. */
class PayloadTooLargeError extends Error {}

export function createGateway(opts: GatewayOptions = {}) {
  const store = opts.store ?? openGatewayStore(opts.dbPath ?? ":memory:")
  const windows = new Map<string, { count: number; reset: number }>()
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const now = opts.now ?? Date.now
  const openrouterKey = opts.openrouterKey ?? process.env.OPENROUTER_API_KEY?.trim() ?? ""
  const adminToken = opts.adminToken ?? process.env.GRIST_ADMIN_TOKEN?.trim() ?? ""
  // Env-only on purpose: no admin email is hardcoded into the build, and an
  // empty value disables the Google sign-in admin shortcut entirely.
  const adminEmail = (opts.adminEmail ?? process.env.GRIST_ADMIN_EMAIL ?? "").trim().toLowerCase()
  const globalBudget = opts.globalBudgetUsd ?? Number(process.env.GRIST_GLOBAL_BUDGET_USD ?? DEFAULT_GLOBAL_BUDGET)
  const trustedProxies = parseTrustedProxies(opts.trustedProxies ?? process.env.GRIST_TRUSTED_PROXIES ?? "")
  const limits = { ...RATE_LIMITS, ...opts.rateLimits }
  const alert =
    opts.alert ??
    ((message: string) => {
      console.error(`[grist-gateway] ${message}`)
      const hook = process.env.GRIST_ALERT_WEBHOOK?.trim()
      if (!hook) return
      void globalThis.fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      })
    })

  async function handle(req: Request, serverOrPeer?: Bun.Server<undefined> | string): Promise<Response> {
    // Bun.serve passes its Server as the second fetch arg; tests and other
    // callers may pass a peer IP string directly.
    const peerIp = typeof serverOrPeer === "string" ? serverOrPeer : serverOrPeer?.requestIP(req)?.address
    try {
      return await route(req, peerIp)
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return json(413, { error: "payload too large" })
      throw error
    }
  }

  async function route(req: Request, peerIp?: string): Promise<Response> {
    const url = new URL(req.url)
    const pathname = url.pathname.replace(/\/+$/, "") || "/"

    if (req.method === "GET" && pathname === "/health") {
      return json(200, { ok: true })
    }

    if (req.method === "POST" && pathname === "/v1/invite/validate") {
      return validate(req, peerIp)
    }
    if (req.method === "POST" && pathname === "/v1/auth/device/approve") {
      return approveDevice(req, peerIp)
    }
    if (req.method === "POST" && pathname === "/v1/auth/device/poll") {
      return pollDevice(req)
    }
    if (req.method === "POST" && pathname === "/v1/auth/device") {
      return startDevice(clientIp(req, peerIp, trustedProxies))
    }
    if (req.method === "GET" && pathname === "/v1/auth/config") {
      return authConfig()
    }
    if (req.method === "POST" && pathname === "/v1/auth/session") {
      return firebaseSession(req)
    }
    if (req.method === "POST" && pathname === "/v1/auth/session/bind") {
      return firebaseBind(req, peerIp)
    }
    if (req.method === "POST" && pathname === "/v1/gate/route") {
      return gateRoute(req)
    }
    if (req.method === "POST" && (pathname === "/v1/completions" || pathname === "/v1/chat/completions")) {
      return completions(req, peerIp)
    }
    if (req.method === "GET" && pathname === "/v1/usage") {
      return usage(req)
    }
    if (pathname === "/v1/api-keys" || pathname.startsWith("/v1/api-keys/")) {
      return apiKeys(req, pathname, peerIp)
    }
    if (req.method === "POST" && pathname === "/v1/access/requests") {
      return accessRequest(req, peerIp)
    }
    if (pathname.startsWith("/v1/admin/")) {
      return admin(req, pathname)
    }
    if (req.method === "GET") return serveSite(opts.siteRoot ?? SITE_ROOT, pathname)
    return json(404, { error: "not found" })
  }

  async function accessRequest(req: Request, peerIp?: string): Promise<Response> {
    if (!allowValidate(`access:${clientIp(req, peerIp, trustedProxies)}`)) return json(429, { ok: false })
    const body = await readJson(req)
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
    if (!validEmail(email)) return json(400, { ok: false })
    store.createAccessRequest({
      email,
      name: cleanText(body?.name, 80),
      note: cleanText(body?.note, 500),
    })
    return json(200, { ok: true })
  }

  function mintForRequest(id: string): Response {
    const row = store.getAccessRequest(id)
    if (!row || row.status === "dismissed" || row.status === "sent") return json(404, { error: "not found" })
    if (row.invite_code) return json(200, issuedInvite(row, store.getInvite(row.invite_code)))
    const invite = store.createInvite({ note: row.email })
    const next = store.attachRequestCode(id, invite.code)
    if (!next?.invite_code) return json(404, { error: "not found" })
    return json(200, issuedInvite(next, invite))
  }

  function markRequest(id: string, status: "sent" | "dismissed"): Response {
    const next = store.setAccessRequestStatus(id, status)
    if (!next) return json(400, { error: "not found" })
    return json(200, { ok: true })
  }

  function publicRequests() {
    return store
      .listAccessRequests()
      .slice()
      .sort((a, b) => requestRank(a.status) - requestRank(b.status) || b.created_at - a.created_at)
      .map((row) => {
        const invite = row.invite_code ? store.getInvite(row.invite_code) : undefined
        return {
          id: row.id,
          email: row.email,
          name: row.name,
          note: row.note,
          status: row.status,
          code: row.invite_code,
          cap_usd: invite?.cap_usd ?? null,
          days: invite ? inviteDays(invite) : null,
          created_at: new Date(row.created_at).toISOString(),
        }
      })
  }

  async function validate(req: Request, peerIp?: string): Promise<Response> {
    if (!allowValidate(clientIp(req, peerIp, trustedProxies))) {
      return json(401, { valid: false })
    }
    const body = await readJson(req)
    const code = typeof body?.code === "string" ? body.code : ""
    const invite = store.getInvite(code)
    if (!invite || !inviteUsable(invite, now())) {
      return json(200, { valid: false })
    }
    return json(200, publicInvite(invite))
  }

  function startDevice(ip: string): Response {
    if (!allowWindow(`devicestart:${ip}`, limits.deviceStart.limit, limits.deviceStart.windowMs)) {
      return json(429, { error: "too many device login attempts" })
    }
    const login = store.createCliLogin({ expiresAt: now() + DEVICE_TTL_MS })
    return json(200, {
      device_code: login.device_code,
      user_code: login.user_code,
      verification_uri: `/login?device=${login.user_code}`,
      interval: 1,
      expires_in: Math.floor(DEVICE_TTL_MS / 1000),
    })
  }

  async function approveDevice(req: Request, peerIp?: string): Promise<Response> {
    if (!allowValidate(clientIp(req, peerIp, trustedProxies))) {
      return json(401, { ok: false })
    }
    const body = await readJson(req)
    const user_code = typeof body?.user_code === "string" ? body.user_code : ""
    const raw = typeof body?.code === "string" ? body.code : ""
    const invite = store.getInvite(raw)
    if (!invite || !inviteUsable(invite, now())) {
      return json(200, { ok: false })
    }
    if (!store.approveCliLogin(user_code, invite.code, now())) {
      return json(200, { ok: false })
    }
    return json(200, { ok: true, plan: "beta" })
  }

  async function pollDevice(req: Request): Promise<Response> {
    const body = await readJson(req)
    const device_code = typeof body?.device_code === "string" ? body.device_code : ""
    if (!device_code) return json(401, { status: "expired" })
    const result = store.pollCliLogin(device_code, now())
    if (result.status === "approved") return json(200, result)
    if (result.status === "pending") return json(200, result)
    return json(401, result)
  }

  function authConfig(): Response {
    const config = firebasePublicConfig()
    if (!config) return json(200, { enabled: false })
    return json(200, { enabled: true, ...config })
  }

  async function firebaseSession(req: Request): Promise<Response> {
    const body = await readJson(req)
    const token = typeof body?.id_token === "string" ? body.id_token : ""
    const user = await verifyFirebaseIdToken(token, fetchImpl)
    if (!user) return json(401, { error: "unauthorized" })
    if (isAdminEmail(user.email)) {
      const account = ensureAdminAccount(user)
      return json(200, {
        ok: true,
        admin: true,
        needs_invite: false,
        email: user.email,
        code: account.invite_code,
      })
    }
    const account = store.getAccount(user.uid)
    if (!account) return json(200, { ok: true, admin: false, needs_invite: true, email: user.email })
    const invite = store.getInvite(account.invite_code)
    if (!invite || !inviteUsable(invite, now())) {
      return json(200, { ok: true, admin: false, needs_invite: true, email: user.email })
    }
    return json(200, { ok: true, admin: false, needs_invite: false, email: user.email, code: invite.code })
  }

  async function firebaseBind(req: Request, peerIp?: string): Promise<Response> {
    if (!allowValidate(clientIp(req, peerIp, trustedProxies))) return json(401, { ok: false })
    const body = await readJson(req)
    const token = typeof body?.id_token === "string" ? body.id_token : ""
    const raw = typeof body?.code === "string" ? body.code : ""
    const user = await verifyFirebaseIdToken(token, fetchImpl)
    if (!user) return json(401, { ok: false })
    const invite = store.getInvite(raw)
    if (!invite || !inviteUsable(invite, now())) return json(200, { ok: false })
    const account = store.bindAccount({ uid: user.uid, email: user.email, inviteCode: invite.code })
    if (!account) return json(200, { ok: false })
    return json(200, { ok: true, code: invite.code })
  }

  async function gateRoute(req: Request): Promise<Response> {
    const invite = await resolveInvite(req)
    if (invite instanceof Response) return invite
    if (invite.spent_usd >= invite.cap_usd) return capHit(invite)
    if (!allowWindow(`gate:${invite.code}`, limits.gateRoute.limit, limits.gateRoute.windowMs)) {
      return json(429, { error: "too many routing requests" })
    }
    const body = await readJson(req, MAX_GATE_BYTES)
    const text = typeof body?.text === "string" ? body.text : ""
    const sessionID = typeof body?.session_id === "string" ? body.session_id : undefined
    const started = now()
    const { scores, provider } = await scoreTask(text, opts.typesafeKey ?? typesafeKey())
    // Jev scoring is a paid upstream call; debit a flat per-call cost so the
    // invite cap reflects it. Shadow scoring never reaches a paid provider.
    if (provider === "jev") {
      const updated = store.addSpend({
        code: invite.code,
        keyId: invite.keyId,
        model: "gate/route",
        rung: "cheapest",
        inputTokens: 0,
        outputTokens: 0,
        usd: GATE_ROUTE_COST_USD,
      })
      maybeAlert(store, updated, alert, globalBudget, now)
    }
    const mode = store.getMode()
    const { rung, reasons } = composeRung(scores, undefined, mode)
    const model = publicModelRef(rung)
    const mechanisms = composeMechanisms(text, loadMechanismProfile())
    const decision = {
      rung,
      model: { provider_id: model.providerID, model_id: model.modelID },
      difficulty: scores.difficulty,
      sensitivity: scores.sensitivity,
      underspecified: scores.underspecified,
      reasons,
      mechanisms: {
        observation_pack: mechanisms.observationPack,
        action_fusion: mechanisms.actionFusion,
      },
      provider,
      mode,
      latency_ms: now() - started,
    }
    store.recordBurnIn({
      kind: "decision",
      sessionID,
      text: text.slice(0, 240),
      ...decision,
    })
    return json(200, decision)
  }

  async function completions(req: Request, peerIp?: string): Promise<Response> {
    const started = now()
    const invite = await resolveInvite(req)
    const authMs = now() - started
    if (invite instanceof Response) {
      console.info(`[grist-gateway] completions auth_ms=${authMs} status=${invite.status}`)
      return invite
    }
    if (invite.spent_usd >= invite.cap_usd) return capHit(invite)
    if (!allowWindow(`completions:${invite.code}`, limits.completions.limit, limits.completions.windowMs)) {
      return json(429, { error: "too many requests" })
    }

    const body = await readJson(req, MAX_JSON_BYTES)
    const rawModel = typeof body?.model === "string" ? body.model : ""
    const publicID = publicLadderID(rawModel)
    if (!publicID || !isLadderModel(rawModel)) {
      return json(400, { error: "model not on ladder" })
    }
    // Operating mode clamps the ladder server-side: in `capped` mode a
    // frontier request degrades to medium rather than paying frontier prices.
    const { rung: effectivePublicID } = applyModeCap(publicID, store.getMode())
    const upstreamModel = upstreamLadderID(effectivePublicID)
    if (!upstreamModel) {
      return json(500, { error: "ladder misconfigured" })
    }
    if (!openrouterKey) {
      return json(503, { error: "gateway has no OpenRouter key" })
    }

    const stream = Boolean(body?.stream)
    const payload = upstreamPayload(body ?? {}, upstreamModel, stream)
    const upstreamStarted = now()
    const upstream = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/pranav6226/grist",
        "X-Title": "Grist",
      },
      body: JSON.stringify(payload),
    })
    const upstreamMs = now() - upstreamStarted
    console.info(
      `[grist-gateway] completions rung=${publicID} stream=${stream} status=${upstream.status} auth_ms=${authMs} upstream_ms=${upstreamMs}`,
    )

    if (!stream) {
      const data = (await upstream.json()) as Record<string, unknown>
      meterFromUsage(store, invite, upstreamModel, usageFromUnknown(data.usage), alert, globalBudget, now)
      return json(upstream.status, redactCompletion(data, publicID))
    }

    if (!upstream.body) return new Response(null, { status: upstream.status })
    return new Response(meteredSse(upstream.body, store, invite, upstreamModel, publicID, alert, globalBudget, now), {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
      },
    })
  }

  async function usage(req: Request): Promise<Response> {
    const invite = await resolveInvite(req)
    if (invite instanceof Response) return invite
    const events = store.usageFor(invite.code)
    const by_rung = { cheapest: 0, medium: 0, frontier: 0 }
    for (const event of events) by_rung[event.rung] += event.usd
    return json(200, {
      spent_usd: roundUsd(invite.spent_usd),
      cap_usd: invite.cap_usd,
      remaining_usd: roundUsd(Math.max(0, invite.cap_usd - invite.spent_usd)),
      plan: "beta",
      expires_at: new Date(invite.expires_at).toISOString(),
      by_rung: {
        cheapest: roundUsd(by_rung.cheapest),
        medium: roundUsd(by_rung.medium),
        frontier: roundUsd(by_rung.frontier),
      },
    })
  }

  async function apiKeys(req: Request, pathname: string, peerIp?: string): Promise<Response> {
    const invite = await requireAccount(req)
    if (invite instanceof Response) return invite

    if (req.method === "GET" && pathname === "/v1/api-keys") {
      return json(200, { keys: store.listApiKeys(invite.code).map(serializeApiKey) })
    }

    if (req.method === "POST" && pathname === "/v1/api-keys") {
      if (!allowWindow(`keymint:${invite.code}`, limits.keyMint.limit, limits.keyMint.windowMs)) {
        return json(429, { error: "too many key requests" })
      }
      const body = await readJson(req)
      const name = typeof body?.name === "string" ? body.name : undefined
      const created = store.createApiKey({ inviteCode: invite.code, name })
      if (!created) return json(400, { error: "key limit reached" })
      return json(200, { key: created.secret, ...serializeApiKey(created.key) })
    }

    if (req.method === "DELETE" && pathname.startsWith("/v1/api-keys/")) {
      const id = decodeURIComponent(pathname.slice("/v1/api-keys/".length))
      const ok = store.revokeApiKey({ inviteCode: invite.code, id })
      if (!ok) return json(404, { error: "not found" })
      return json(200, { revoked: true })
    }

    return json(404, { error: "not found" })
  }

  async function admin(req: Request, pathname: string): Promise<Response> {
    const denied = await requireAdmin(req)
    if (denied) return denied

    if (req.method === "GET" && pathname === "/v1/admin/invites") {
      return json(200, adminOverview())
    }

    if (req.method === "POST" && pathname === "/v1/admin/invites") {
      const body = await readJson(req)
      const cap = typeof body?.cap_usd === "number" && body.cap_usd > 0 ? body.cap_usd : 5
      const note = typeof body?.note === "string" ? body.note.trim() : ""
      const expiresAt =
        typeof body?.expires_at === "string" ? Date.parse(body.expires_at) : undefined
      const days = typeof body?.days === "number" && body.days > 0 ? body.days : undefined
      const rawCount = typeof body?.count === "number" ? body.count : 1
      const count = Number.isInteger(rawCount) && rawCount > 0 ? Math.min(rawCount, 25) : 1
      const expires =
        Number.isFinite(expiresAt) ? expiresAt : days ? now() + days * 24 * 60 * 60 * 1000 : undefined
      const invites = Array.from({ length: count }, () =>
        store.createInvite({
          capUsd: cap,
          note: note || undefined,
          expiresAt: expires,
        }),
      )
      return json(200, { code: invites[0]?.code, codes: invites.map((row) => row.code) })
    }

    if (req.method === "DELETE" && pathname.startsWith("/v1/admin/invites/")) {
      const raw = decodeURIComponent(pathname.slice("/v1/admin/invites/".length))
      const ok = store.revoke(raw)
      if (!ok) return json(401, { error: "unauthorized" })
      return json(200, { revoked: true })
    }

    if (req.method === "GET" && pathname === "/v1/admin/usage") {
      return json(200, adminOverview())
    }

    if (req.method === "GET" && pathname === "/v1/admin/requests") {
      return json(200, { requests: publicRequests() })
    }

    if (pathname.startsWith("/v1/admin/requests/")) {
      const rest = pathname.slice("/v1/admin/requests/".length)
      const slash = rest.indexOf("/")
      const id = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash))
      const action = slash === -1 ? "" : rest.slice(slash + 1)
      if (req.method === "POST" && action === "code") return mintForRequest(id)
      if (req.method === "POST" && action === "sent") return markRequest(id, "sent")
      if (req.method === "POST" && action === "dismiss") return markRequest(id, "dismissed")
    }

    if (req.method === "POST" && pathname === "/v1/admin/mode") {
      const body = await readJson(req)
      const mode = body?.mode
      if (mode !== "normal" && mode !== "capped" && mode !== "cheapest") {
        return json(400, { error: "mode must be normal | capped | cheapest" })
      }
      store.setMode(mode as OperatingMode)
      return json(200, { mode })
    }

    return json(404, { error: "not found" })
  }

  function allowValidate(ip: string): boolean {
    return allowWindow(ip, limits.validate.limit, limits.validate.windowMs)
  }

  function allowWindow(bucket: string, limit: number, windowMs: number): boolean {
    const t = now()
    const cur = windows.get(bucket)
    if (!cur || t >= cur.reset) {
      windows.set(bucket, { count: 1, reset: t + windowMs })
      return true
    }
    if (cur.count >= limit) return false
    cur.count += 1
    return true
  }

  async function resolveInvite(req: Request): Promise<ResolvedInvite | Response> {
    const apiKey = req.headers.get("X-Grist-Api-Key") ?? bearerApiKey(req)
    if (apiKey) {
      const invite = store.inviteForApiKey(apiKey, now())
      if (!invite || !inviteUsable(invite, now())) return json(401, { error: "unauthorized" })
      return invite
    }
    const raw = req.headers.get("X-Grist-Invite") ?? ""
    if (raw) {
      const invite = store.getInvite(raw)
      if (!invite || !inviteUsable(invite, now())) return json(401, { error: "unauthorized" })
      return { ...invite, keyId: null }
    }
    const bearer = req.headers.get("Authorization") ?? ""
    if (!bearer.startsWith("Bearer ")) return json(401, { error: "unauthorized" })
    const user = await verifyFirebaseIdToken(bearer.slice(7).trim(), fetchImpl)
    if (!user) return json(401, { error: "unauthorized" })
    const account = store.getAccount(user.uid)
    if (!account) return json(401, { error: "unauthorized" })
    const invite = store.getInvite(account.invite_code)
    if (!invite || !inviteUsable(invite, now())) return json(401, { error: "unauthorized" })
    return { ...invite, keyId: null }
  }

  async function requireAccount(req: Request): Promise<ResolvedInvite | Response> {
    if (req.headers.get("X-Grist-Api-Key") || bearerApiKey(req)) {
      return json(401, { error: "unauthorized" })
    }
    return resolveInvite(req)
  }

  async function requireAdmin(req: Request): Promise<Response | undefined> {
    // The admin token is required, always. A Firebase session — even the
    // founder's Google account — is not sufficient on its own: compromising
    // that account alone must not yield admin API access. When no token is
    // configured, admin endpoints are closed entirely (fail closed).
    if (!adminToken || req.headers.get("X-Grist-Admin") !== adminToken) {
      return json(401, { error: "unauthorized" })
    }
  }

  function isAdminEmail(email?: string) {
    if (!email || !adminEmail) return false
    return email.trim().toLowerCase() === adminEmail
  }

  function ensureAdminAccount(user: FirebaseUser) {
    const existing = store.getAccount(user.uid)
    if (existing) return existing
    const invite = store.createInvite({ note: "admin", capUsd: 50 })
    return (
      store.bindAccount({ uid: user.uid, email: user.email, inviteCode: invite.code }) ?? {
        firebase_uid: user.uid,
        invite_code: invite.code,
        email: user.email ?? null,
        created_at: Date.now(),
      }
    )
  }

  function adminOverview() {
    const invites = store.invitesForAdmin()
    const capHits = invites.filter((row) => row.spent_usd >= row.cap_usd).length
    return {
      spent_usd: roundUsd(invites.reduce((sum, row) => sum + row.spent_usd, 0)),
      global_budget_usd: globalBudget,
      codes: invites.length,
      cap_hit_rate: invites.length ? capHits / invites.length : 0,
      invites: invites
        .slice()
        .sort((a, b) => b.created_at - a.created_at)
        .map((row) => ({
          code: row.code,
          note: row.note,
          email: row.email,
          spent_usd: roundUsd(row.spent_usd),
          cap_usd: row.cap_usd,
          remaining_usd: roundUsd(Math.max(0, row.cap_usd - row.spent_usd)),
          expires_at: new Date(row.expires_at).toISOString(),
          revoked: Boolean(row.revoked),
          created_at: new Date(row.created_at).toISOString(),
        })),
      leaderboard: invites
        .slice()
        .sort((a, b) => b.spent_usd - a.spent_usd)
        .slice(0, 20)
        .map((row) => ({
          code: row.code,
          spent_usd: roundUsd(row.spent_usd),
          cap_usd: row.cap_usd,
          revoked: Boolean(row.revoked),
        })),
    }
  }

  return { fetch: handle, store }
}

function inviteUsable(invite: InviteRow, t: number): boolean {
  if (invite.revoked) return false
  if (invite.expires_at <= t) return false
  return true
}

function publicInvite(invite: InviteRow) {
  return {
    valid: true,
    plan: "beta",
    spend_cap_usd: invite.cap_usd,
    remaining_usd: roundUsd(Math.max(0, invite.cap_usd - invite.spent_usd)),
  }
}

function capHit(invite: InviteRow): Response {
  return json(402, {
    error: `Invite spend cap reached ($${invite.cap_usd.toFixed(2)}). Ask the founder for a top-up.`,
  })
}

/**
 * Build the upstream payload from an explicit allowlist and clamp generation
 * length. The OpenRouter key belongs to the founder, so client-supplied
 * `provider` / `models` / `reasoning` / `plugins` could otherwise route to a
 * costlier provider than the ladder price the account is metered against.
 */
function upstreamPayload(
  body: Record<string, unknown>,
  upstreamModel: string,
  stream: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { model: upstreamModel, stream }
  for (const field of UPSTREAM_FIELDS) {
    if (body[field] !== undefined) payload[field] = body[field]
  }
  const requested = Number(body.max_tokens ?? body.max_completion_tokens)
  payload.max_tokens =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_COMPLETION_TOKENS)
      : MAX_COMPLETION_TOKENS
  if (stream) payload.stream_options = { include_usage: true }
  return payload
}

function meterFromUsage(
  store: GatewayStore,
  invite: ResolvedInvite,
  model: string,
  usage: { input: number; output: number } | undefined,
  alert: (message: string) => void,
  globalBudget: number,
  now: () => number,
) {
  if (!usage) return
  const price = priceForModel(model)
  const usd = usdForUsage(model, usage.input, usage.output)
  if (usd <= 0) return
  const updated = store.addSpend({
    code: invite.code,
    keyId: invite.keyId,
    model,
    rung: price?.rung ?? "cheapest",
    inputTokens: usage.input,
    outputTokens: usage.output,
    usd,
  })
  maybeAlert(store, updated, alert, globalBudget, now)
}

function maybeAlert(
  store: GatewayStore,
  invite: InviteRow,
  alert: (message: string) => void,
  globalBudget: number,
  now: () => number,
) {
  const hour = store.spendSince(invite.code, now() - 60 * 60 * 1000)
  if (hour > HOURLY_ABUSE_USD) {
    // Invite codes are bearer credentials: alert on a fingerprint, never the code.
    alert(`invite ${inviteFingerprint(invite.code)} burned $${hour.toFixed(2)} in the last hour`)
  }
  const global = store.allInvites().reduce((sum, row) => sum + row.spent_usd, 0)
  if (global >= globalBudget * 0.8 && !store.getAlertFlag("global_80")) {
    store.setAlertFlag("global_80")
    alert(`global test spend $${global.toFixed(2)} is ≥80% of $${globalBudget}`)
  }
}

/** Non-reversible fingerprint identifying an invite in logs/alerts without leaking the code. */
function inviteFingerprint(code: string): string {
  return createHash("sha256").update(code).digest("hex").slice(0, 12)
}

function meteredSse(
  body: ReadableStream<Uint8Array>,
  store: GatewayStore,
  invite: ResolvedInvite,
  model: string,
  publicID: string,
  alert: (message: string) => void,
  globalBudget: number,
  now: () => number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let leftover = ""
  let usage: { input: number; output: number } | undefined
  // Meter exactly once: normal completion, mid-stream upstream error, or
  // client disconnect (cancel) must not double-bill.
  let metered = false
  const meterOnce = () => {
    if (metered) return
    metered = true
    meterFromUsage(store, invite, model, usage, alert, globalBudget, now)
  }
  return new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          if (leftover) {
            const parsed = usageFromSse(leftover)
            if (parsed) usage = parsed
            controller.enqueue(encoder.encode(`${redactSseLine(leftover, publicID)}\n`))
          }
          meterOnce()
          controller.close()
          return
        }
        leftover += decoder.decode(chunk.value, { stream: true })
        const lines = leftover.split("\n")
        leftover = lines.pop() ?? ""
        if (lines.length === 0) return
        const out: string[] = []
        for (const line of lines) {
          const parsed = usageFromSse(line)
          if (parsed) usage = parsed
          out.push(redactSseLine(line, publicID))
        }
        controller.enqueue(encoder.encode(`${out.join("\n")}\n`))
      } catch (err) {
        meterOnce()
        throw err
      }
    },
    cancel() {
      meterOnce()
    },
  })
}

function redactCompletion(data: Record<string, unknown>, publicID: string) {
  const next: Record<string, unknown> = { ...data, model: publicID }
  delete next.provider
  return next
}

function redactSseLine(line: string, publicID: string) {
  const trimmed = line.trim()
  if (!trimmed.startsWith("data:")) return line
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === "[DONE]") return line
  try {
    return `data: ${JSON.stringify(redactCompletion(JSON.parse(payload) as Record<string, unknown>, publicID))}`
  } catch {
    return line
  }
}

function usageFromSse(line: string) {
  const trimmed = line.trim()
  if (!trimmed.startsWith("data:")) return
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === "[DONE]") return
  try {
    return usageFromUnknown((JSON.parse(payload) as { usage?: unknown }).usage)
  } catch {
    return
  }
}

function usageFromUnknown(value: unknown): { input: number; output: number } | undefined {
  if (!value || typeof value !== "object") return
  const rec = value as Record<string, unknown>
  const input = Number(rec.prompt_tokens ?? rec.input_tokens ?? 0)
  const output = Number(rec.completion_tokens ?? rec.output_tokens ?? 0)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return
  return { input, output }
}

/**
 * Read and parse a JSON request body, rejecting anything larger than
 * `maxBytes`. `Content-Length` is checked before buffering; the decoded text
 * is measured again for chunked bodies that omit the header.
 */
async function readJson(
  req: Request,
  maxBytes = MAX_JSON_BYTES,
): Promise<Record<string, unknown> | undefined> {
  const declared = Number(req.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) throw new PayloadTooLargeError()
  const text = await req.text()
  if (new TextEncoder().encode(text).length > maxBytes) throw new PayloadTooLargeError()
  if (!text.trim()) return
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== "object") return
    return parsed as Record<string, unknown>
  } catch {
    return
  }
}

async function serveSite(root: string, pathname: string): Promise<Response> {
  const skill = await serveAgentSkill(root, pathname)
  if (skill) return skill
  const dmg = pathname.match(MAC_DMG)?.[1]
  if (dmg) return serveMacDmg(root, dmg)
  const name = SITE_PAGES.has(pathname) ? "index.html" : pathname.replace(/^\//, "")
  const type = SITE_FILES[name]
  if (!type) return json(404, { error: "not found" })
  const file = Bun.file(path.join(root, name))
  if (!(await file.exists())) return json(404, { error: "not found" })
  return new Response(file, { headers: { "Content-Type": type } })
}

const GRIST_SKILL_DESCRIPTION =
  "Delegate multi-step coding tasks in a git repo to Grist: features, bug fixes, refactors spanning multiple files. Not for single-file edits or non-coding questions."

async function serveAgentSkill(root: string, pathname: string): Promise<Response | undefined> {
  if (
    pathname !== "/grist-skill.md" &&
    pathname !== "/.well-known/agent-skills/grist/SKILL.md" &&
    pathname !== "/.well-known/agent-skills/index.json"
  ) {
    return
  }
  const file = Bun.file(path.join(root, "grist-skill.md"))
  if (!(await file.exists())) return json(404, { error: "not found" })
  if (pathname !== "/.well-known/agent-skills/index.json") {
    return new Response(file, { headers: { "Content-Type": "text/markdown; charset=utf-8" } })
  }
  const digest = createHash("sha256").update(await file.bytes()).digest("hex")
  return json(200, {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "grist",
        type: "skill-md",
        description: GRIST_SKILL_DESCRIPTION,
        url: "/.well-known/agent-skills/grist/SKILL.md",
        digest: `sha256:${digest}`,
      },
    ],
  })
}

async function serveMacDmg(root: string, name: string): Promise<Response> {
  const file = Bun.file(path.join(root, "download", name))
  if (await file.exists()) {
    return new Response(file, {
      headers: {
        "Content-Type": "application/x-apple-diskimage",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "public, max-age=3600",
      },
    })
  }
  const remote = PUBLIC_MAC_DMGS[name]
  if (remote) return Response.redirect(remote, 302)
  return json(404, { error: "not found" })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function issuedInvite(
  row: { email: string; name: string | null; invite_code: string | null },
  invite: { code: string; cap_usd: number; created_at: number; expires_at: number } | undefined,
) {
  return {
    ok: true,
    code: invite?.code ?? row.invite_code,
    email: row.email,
    name: row.name,
    cap_usd: invite?.cap_usd ?? 5,
    days: invite ? inviteDays(invite) : 30,
  }
}

function inviteDays(invite: { created_at: number; expires_at: number }) {
  return Math.max(1, Math.round((invite.expires_at - invite.created_at) / 86_400_000))
}

function requestRank(status: string) {
  if (status === "open") return 0
  if (status === "coded") return 1
  if (status === "sent") return 2
  return 9
}

function validEmail(email: string) {
  return email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function cleanText(value: unknown, max: number) {
  if (typeof value !== "string") return
  const text = value.replace(/[\u0000-\u001F\u007F]/g, "").trim()
  if (!text) return
  return text.slice(0, max)
}

/**
 * Best-effort client IP for rate limiting. `X-Forwarded-For` / `X-Real-IP`
 * are only trusted when the socket peer is a known proxy: an entry in
 * `trusted` (from GRIST_TRUSTED_PROXIES, IPs or IPv4 CIDRs) or — when no
 * list is configured — a private/loopback peer, which is how the Railway
 * edge proxy reaches the gateway. Otherwise the socket peer is used, so a
 * client connecting directly cannot spoof its way around rate limits.
 * When no peer is known (tests, non-Bun runtimes) falls back to the
 * legacy header-first behavior.
 */
function clientIp(req: Request, peer: string | undefined, trusted: string[]): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const realIp = req.headers.get("x-real-ip")?.trim()
  if (peer && proxyTrusted(peer, trusted)) return forwarded || realIp || peer
  if (peer) return peer
  return forwarded || realIp || "local"
}

function parseTrustedProxies(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function proxyTrusted(peer: string, trusted: string[]): boolean {
  if (trusted.length > 0) return trusted.some((entry) => matchProxyEntry(peer, entry))
  return isPrivateAddress(peer)
}

function matchProxyEntry(peer: string, entry: string): boolean {
  if (!entry.includes("/")) return peer.toLowerCase() === entry.toLowerCase()
  return ipv4InCidr(peer, entry)
}

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".")
  if (parts.length !== 4) return undefined
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const b = Number(part)
    if (b > 255) return undefined
    n = n * 256 + b
  }
  return n
}

function ipv4InCidr(peer: string, cidr: string): boolean {
  const slash = cidr.indexOf("/")
  const base = ipv4ToInt(cidr.slice(0, slash))
  const mask = Number(cidr.slice(slash + 1))
  const addr = ipv4ToInt(peer)
  if (base === undefined || addr === undefined || !Number.isInteger(mask) || mask < 0 || mask > 32) return false
  const maskInt = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0
  return (addr & maskInt) >>> 0 === (base & maskInt) >>> 0
}

function isPrivateAddress(ip: string): boolean {
  let v = ip.toLowerCase().trim()
  if (v.startsWith("::ffff:")) v = v.slice("::ffff:".length)
  if (v.includes(":")) {
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")
  }
  const n = ipv4ToInt(v)
  if (n === undefined) return false
  return (
    (n & 0xff000000) === 0x0a000000 || // 10/8
    (n & 0xfff00000) === 0xac100000 || // 172.16/12
    (n & 0xffff0000) === 0xc0a80000 || // 192.168/16
    (n & 0xff000000) === 0x7f000000 // 127/8
  )
}

function roundUsd(n: number) {
  return Math.round(n * 1e6) / 1e6
}

function bearerApiKey(req: Request) {
  const bearer = req.headers.get("Authorization") ?? ""
  if (!bearer.startsWith("Bearer ")) return ""
  const token = bearer.slice(7).trim()
  return canonicalApiKey(token) ? token : ""
}

function serializeApiKey(row: {
  id: string
  name: string
  prefix: string
  created_at: number
  last_used_at: number | null
  revoked: boolean
}) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    created_at: new Date(row.created_at).toISOString(),
    last_used_at: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    revoked: row.revoked,
  }
}
