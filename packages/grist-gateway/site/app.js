import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js"

const KEY = "grist_invite"
const state = {
  auth: undefined,
  ready: false,
  admin: false,
  uid: "",
  sessionKnown: false,
}
let sessionTicket = 0
let renderChain = Promise.resolve()
let authGen = 0
// First/last name from the sign-up form, consumed once by afterFirebase().
let pendingSignupNames = null

const views = {
  "/": "view-home",
  "/login": "view-login",
  "/dashboard": "view-dashboard",
  "/dashboard/api": "view-dashboard",
  "/dashboard/models": "view-dashboard",
  "/admin": "view-admin",
  "/docs": "view-docs",
  "/docs/skills": "view-docs-skills",
  "/privacy": "view-privacy",
  "/terms": "view-terms",
  "/acceptable-use": "view-acceptable-use",
  "/cookies": "view-cookies",
}

const titles = {
  "/": "Grist — a complete coding-agent harness",
  "/login": "Sign in — Grist",
  "/dashboard": "Usage — Grist",
  "/dashboard/api": "API keys — Grist",
  "/dashboard/models": "Models — Grist",
  "/admin": "Admin — Grist",
  "/docs": "Docs — Grist",
  "/docs/skills": "Agent skills — Grist",
  "/privacy": "Privacy Policy — Grist",
  "/terms": "Terms of Use — Grist",
  "/acceptable-use": "Acceptable Use — Grist",
  "/cookies": "Cookie Policy — Grist",
}

function pathOf() {
  return window.location.pathname.replace(/\/+$/, "") || "/"
}

function device() {
  return new URLSearchParams(window.location.search).get("device") || ""
}

function invite() {
  return localStorage.getItem(KEY) || ""
}

function signedIn() {
  return Boolean(invite()) || state.admin
}

function setLoginCopy(input) {
  document.getElementById("login-kicker").textContent = input.kicker
  document.getElementById("login-title").textContent = input.title
  document.getElementById("login-lede").textContent = input.lede
}

function showAuthStep() {
  document.getElementById("login-methods").hidden = false
  document.getElementById("invite-form").hidden = true
  document.getElementById("firebase-missing").hidden = true
  setLoginCopy({
    kicker: "[ account ]",
    title: "Welcome to Grist",
    lede: "Create an account or sign in to get your API key and start running agents.",
  })
  selectAuthTab("signin")
}

function selectAuthTab(which) {
  const signin = which !== "signup"
  for (const id of ["tab-signin", "tab-signup"]) {
    const tab = document.getElementById(id)
    if (!tab) continue
    const active = (id === "tab-signup") !== signin
    tab.classList.toggle("is-active", active)
    tab.setAttribute("aria-selected", active ? "true" : "false")
  }
  const panelSignin = document.getElementById("panel-signin")
  const panelSignup = document.getElementById("panel-signup")
  if (panelSignin) panelSignin.hidden = !signin
  if (panelSignup) panelSignup.hidden = signin
  const error = document.getElementById("login-error")
  if (error) error.hidden = true
}

/** Split a display name ("Ada Lovelace") into { firstName, lastName }. */
function splitName(displayName) {
  const parts = String(displayName || "").trim().split(/\s+/)
  if (!parts.length || !parts[0]) return { firstName: "", lastName: "" }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") }
}

document.getElementById("tab-signin")?.addEventListener("click", () => selectAuthTab("signin"))
document.getElementById("tab-signup")?.addEventListener("click", () => selectAuthTab("signup"))

function showInviteOnly() {
  document.getElementById("login-methods").hidden = true
  document.getElementById("invite-form").hidden = false
  document.getElementById("firebase-missing").hidden = false
  setLoginCopy({
    kicker: "[ account code ]",
    title: "Enter your account code",
    lede: "Google sign-in is not configured on this gateway yet. Enter the account code your operator gave you.",
  })
}

async function bootFirebase() {
  try {
    const response = await fetch("/v1/auth/config")
    const config = await response.json()
    if (!config.enabled) {
      showInviteOnly()
      return
    }
    const app = initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      appId: config.appId,
    })
    state.auth = getAuth(app)
    await state.auth.authStateReady()
    state.uid = state.auth.currentUser?.uid ?? ""
    onAuthStateChanged(state.auth, (user) => {
      const uid = user?.uid ?? ""
      const gen = ++authGen
      if (uid === state.uid) return
      if (!uid) {
        void confirmSignedOut(gen)
        return
      }
      state.uid = uid
      state.sessionKnown = false
      if (!state.ready) return
      void render()
    })
  } catch {
    showInviteOnly()
  }
}

async function confirmSignedOut(gen) {
  // Firebase can emit a signed-out tick between the persisted user and the
  // restored one. Leaving /admin on that tick is the flash back to sign-in.
  await new Promise((resolve) => setTimeout(resolve, 400))
  if (gen !== authGen) return
  const uid = state.auth?.currentUser?.uid ?? ""
  if (uid) {
    if (uid === state.uid) return
    state.uid = uid
    state.sessionKnown = false
    if (state.ready) void render()
    return
  }
  state.uid = ""
  state.admin = false
  state.sessionKnown = false
  showAuthStep()
  if (state.ready) void render()
}

async function afterFirebase() {
  const ticket = ++sessionTicket
  const user = state.auth?.currentUser
  if (!user) {
    if (ticket !== sessionTicket) return
    state.admin = false
    state.sessionKnown = true
    showAuthStep()
    return false
  }
  // Names captured by the sign-up form, sent once with the session request so
  // the account is created with them. Cleared after use.
  const names = pendingSignupNames
  pendingSignupNames = null
  const nameBody =
    names && (names.firstName || names.lastName)
      ? { first_name: names.firstName, last_name: names.lastName }
      : {}
  let data
  try {
    const response = await fetch("/v1/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: await user.getIdToken(), ...nameBody }),
    })
    data = await response.json()
  } catch {
    if (ticket !== sessionTicket) return
    return false
  }
  // A newer sign-in already owns the session. Painting from this response
  // is what bounced the admin view off and back on.
  if (ticket !== sessionTicket) return
  if (!data || !data.ok) return false
  state.admin = Boolean(data.admin)
  state.sessionKnown = true
  if (data.code) localStorage.setItem(KEY, data.code)
  return true
}

function setAuthNav() {
  const in_ = signedIn()
  for (const node of document.querySelectorAll("[data-auth=in]")) node.hidden = !in_
  for (const node of document.querySelectorAll("[data-auth=out]")) node.hidden = in_
  for (const node of document.querySelectorAll("[data-auth=admin]")) node.hidden = !state.admin
}

function show(id) {
  for (const main of document.querySelectorAll("main")) main.hidden = main.id !== id
  document.title = titles[pathOf()] ?? titles["/"]
}

function fail(node, message) {
  node.hidden = false
  node.textContent = message
}

async function headers() {
  const out = {}
  const user = state.auth?.currentUser
  if (user) out.Authorization = `Bearer ${await user.getIdToken()}`
  else if (invite()) out["X-Grist-Invite"] = invite()
  // Admin endpoints require the admin token on every call (B4): the
  // dashboard keeps it in session storage, entered once per tab session.
  const adminToken = sessionStorage.getItem("grist-admin-token")
  if (adminToken) out["X-Grist-Admin"] = adminToken
  return out
}

function wireAdminToken() {
  const input = document.getElementById("admin-token")
  if (!input || input.dataset.wired) return
  input.dataset.wired = "1"
  input.value = sessionStorage.getItem("grist-admin-token") ?? ""
  input.addEventListener("input", () => {
    const token = input.value.trim()
    if (token) sessionStorage.setItem("grist-admin-token", token)
    else sessionStorage.removeItem("grist-admin-token")
  })
}

async function finishCliLogin(code) {
  const error = document.getElementById("login-error")
  error.hidden = true
  const response = await fetch("/v1/auth/device/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_code: device(), code }),
  })
  const data = await response.json()
  if (!data.ok) {
    show("view-login")
    fail(error, "Couldn’t approve this terminal. Run grist auth login again.")
    return
  }
  localStorage.setItem(KEY, code)
  show("view-cli")
  setAuthNav()
}

function goAuthed() {
  if (device()) {
    void finishCliLogin(invite())
    return
  }
  const next = state.admin ? "/admin" : "/dashboard"
  if (pathOf() !== next) history.replaceState(null, "", next)
  return render()
}

function render() {
  const run = renderChain.then(route)
  renderChain = run.then(
    () => {},
    () => {},
  )
  return run
}

async function route() {
  if (!state.ready) return
  if (state.auth?.currentUser && !state.sessionKnown) {
    const admitted = await afterFirebase()
    if (admitted === undefined) return
  }
  const path = pathOf()
  if (path === "/login" && state.auth?.currentUser && !device() && state.sessionKnown) {
    history.replaceState(null, "", state.admin ? "/admin" : "/dashboard")
    show(state.admin ? "view-admin" : "view-dashboard")
    setAuthNav()
    if (state.admin) {
      wireAdminToken()
      void loadAdmin()
      return
    }
    setDashTab("usage")
    void loadDashboard()
    return
  }
  if (path === "/admin") {
    if (!state.admin) {
      history.replaceState(null, "", "/login")
      show("view-login")
      setAuthNav()
      return
    }
    show("view-admin")
    setAuthNav()
    wireAdminToken()
    void loadAdmin()
    return
  }
  if (path === "/dashboard" || path === "/dashboard/api" || path === "/dashboard/models") {
    if (!signedIn()) {
      history.replaceState(null, "", "/login")
      show("view-login")
      setAuthNav()
      return
    }
    show("view-dashboard")
    setDashTab(path === "/dashboard/api" ? "api" : path === "/dashboard/models" ? "models" : "usage")
    setAuthNav()
    void loadDashboard()
    if (path === "/dashboard/api") void loadApiKeys()
    if (path === "/dashboard/models") void loadModels()
    return
  }
  if (path === "/login" && device() && invite()) {
    setAuthNav()
    void finishCliLogin(invite())
    return
  }
  show(views[path] ?? "view-home")
  setAuthNav()
  scrollHash()
}

function scrollHash() {
  const path = pathOf()
  const id = window.location.hash.replace(/^#/, "")
  if ((path === "/" || path === "/docs" || path === "/docs/skills") && id) {
    const node = document.getElementById(id)
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }
  }
  window.scrollTo(0, 0)
}

async function loadDashboard() {
  const error = document.getElementById("dash-error")
  error.hidden = true
  const response = await fetch("/v1/usage", { headers: await headers() })
  if (response.status === 401 || response.status === 402) {
    if (response.status === 401) localStorage.removeItem(KEY)
    fail(
      error,
      response.status === 402
        ? "Spend cap reached. Raise it below to keep running."
        : "Sign in again.",
    )
    if (response.status === 401) render()
    return
  }
  const data = await response.json()
  const remaining = Math.max(0, data.remaining_usd ?? (data.cap_usd - data.spent_usd))
  document.getElementById("remain").textContent = `$${remaining.toFixed(2)} left`
  const until = data.expires_at ? ` · until ${new Date(data.expires_at).toLocaleDateString()}` : ""
  document.getElementById("cap-line").textContent =
    `$${Number(data.spent_usd).toFixed(2)} of $${Number(data.cap_usd).toFixed(2)} used · ${data.plan ?? "beta"}${until}`
  const pct = data.cap_usd ? Math.min(100, (data.spent_usd / data.cap_usd) * 100) : 0
  document.getElementById("spent-bar").style.width = `${pct}%`
  document.getElementById("cap-input").value = Number(data.cap_usd).toFixed(2)
  document.getElementById("cap-msg").textContent = ""
  document.getElementById("cap-form").hidden = false
  const rungs = data.by_rung ?? {}
  document.getElementById("rungs").innerHTML = ["cheapest", "medium", "frontier"]
    .map((name) => `<div><strong>${name}</strong>$${(rungs[name] ?? 0).toFixed(2)}</div>`)
    .join("")
  document.getElementById("cli").textContent =
    `grist auth login --provider grist --gateway ${window.location.origin}`
}

function setDashTab(tab) {
  const titles = { usage: "Usage", api: "API keys", models: "Models" }
  document.getElementById("dash-title").textContent = titles[tab] ?? "Usage"
  document.getElementById("dash-panel-usage").hidden = tab !== "usage"
  document.getElementById("dash-panel-api").hidden = tab !== "api"
  document.getElementById("dash-panel-models").hidden = tab !== "models"
  for (const node of document.querySelectorAll("[data-dash]")) {
    node.classList.toggle("is-on", node.getAttribute("data-dash") === tab)
  }
}

let apiKeysLoad = 0

async function loadApiKeys() {
  const gen = ++apiKeysLoad
  const error = document.getElementById("dash-error")
  const response = await fetch("/v1/api-keys", { headers: await headers() })
  if (gen !== apiKeysLoad) return
  if (response.status !== 200) {
    fail(error, "Couldn’t load API keys. Sign in again.")
    return
  }
  const data = await response.json()
  const keys = data.keys ?? []
  if (!keys.length) {
    document.getElementById("key-list").innerHTML = `<p class="muted">No keys yet.</p>`
    return
  }
  document.getElementById("key-list").innerHTML = keys
    .map((row) => {
      const used = row.last_used_at
        ? `used ${new Date(row.last_used_at).toLocaleDateString()}`
        : "never used"
      const revoke = row.revoked
        ? ""
        : `<button class="text-btn" type="button" data-revoke-key="${row.id}">Revoke</button>`
      return `<article class="admin-row${row.revoked ? " is-revoked" : ""}">
        <code>${row.prefix}</code>
        <span>${escapeHtml(row.name)}</span>
        <span>${row.revoked ? "revoked" : used}</span>
        ${revoke}
      </article>`
    })
    .join("")
}

async function loadAdmin() {
  const error = document.getElementById("admin-error")
  error.hidden = true
  const response = await fetch("/v1/admin/invites", { headers: await headers() })
  if (response.status !== 200) {
    fail(error, "Admin API needs the admin token: paste it above, then reload.")
    return
  }
  const data = await response.json()
  document.getElementById("admin-spent").textContent = `$${Number(data.spent_usd).toFixed(2)} spent`
  document.getElementById("admin-cap-line").textContent =
    `${data.codes} codes · $${Number(data.global_budget_usd).toFixed(0)} global budget · ${Math.round((data.cap_hit_rate ?? 0) * 100)}% at cap`
  document.getElementById("admin-invites").innerHTML = (data.invites ?? [])
    .map((row) => {
      const status = row.revoked ? "revoked" : `$${Number(row.spent_usd).toFixed(2)} / $${Number(row.cap_usd).toFixed(2)}`
      const who = row.email || row.note || "unclaimed"
      const revoke = row.revoked
        ? ""
        : `<button class="text-btn" type="button" data-revoke="${row.code}">Revoke</button>`
      return `<article class="admin-row${row.revoked ? " is-revoked" : ""}">
        <code>${row.code}</code>
        <span>${who}</span>
        <span>${status}</span>
        ${revoke}
      </article>`
    })
    .join("")
}

async function signInWithGoogle() {
  const error = document.getElementById("login-error")
  error.hidden = true
  if (!state.auth) {
    fail(error, "Firebase is not configured.")
    return false
  }
  try {
    await signInWithPopup(state.auth, new GoogleAuthProvider())
  } catch (err) {
    const code = typeof err?.code === "string" ? err.code : ""
    if (code === "auth/unauthorized-domain") {
      fail(error, "This site isn’t on the Firebase authorized domains list.")
      return false
    }
    if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user") {
      fail(error, "Google popup was blocked or closed. Allow popups and try again.")
      return false
    }
    if (code === "auth/operation-not-allowed") {
      fail(error, "Google sign-in isn’t enabled yet. Use email.")
      return false
    }
    fail(error, "Google sign-in failed. Use email, or try again.")
    return false
  }
  // Google accounts carry a display name: record it on the new account.
  const displayName = state.auth.currentUser?.displayName || ""
  if (displayName) pendingSignupNames = splitName(displayName)
  return true
}

document.getElementById("google-btn")?.addEventListener("click", async () => {
  if (await signInWithGoogle()) {
    if (await afterFirebase()) goAuthed()
  }
})

document.getElementById("google-signup-btn")?.addEventListener("click", async () => {
  if (await signInWithGoogle()) {
    if (await afterFirebase()) goAuthed()
  }
})

document.getElementById("email-form")?.addEventListener("submit", async (event) => {
  event.preventDefault()
  const error = document.getElementById("login-error")
  error.hidden = true
  if (!state.auth) {
    fail(error, "Firebase is not configured.")
    return
  }
  const email = document.getElementById("email").value.trim()
  const password = document.getElementById("password").value
  try {
    await signInWithEmailAndPassword(state.auth, email, password)
  } catch (err) {
    const code = typeof err?.code === "string" ? err.code : ""
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
      fail(error, "No account matches that email and password. Check them, or create an account instead.")
      return
    }
    if (code === "auth/too-many-requests") {
      fail(error, "Too many attempts. Try again in a few minutes.")
      return
    }
    fail(error, "Sign-in failed. Check your email and password, or try again.")
    return
  }
  if (await afterFirebase()) goAuthed()
})

document.getElementById("signup-form")?.addEventListener("submit", async (event) => {
  event.preventDefault()
  const error = document.getElementById("login-error")
  error.hidden = true
  if (!state.auth) {
    fail(error, "Firebase is not configured.")
    return
  }
  const firstName = document.getElementById("first-name").value.trim()
  const lastName = document.getElementById("last-name").value.trim()
  const email = document.getElementById("signup-email").value.trim()
  const password = document.getElementById("signup-password").value
  if (!firstName || !lastName) {
    fail(error, "Enter your first and last name.")
    return
  }
  let credential
  try {
    credential = await createUserWithEmailAndPassword(state.auth, email, password)
  } catch (err) {
    const code = typeof err?.code === "string" ? err.code : ""
    if (code === "auth/email-already-in-use") {
      fail(error, "That email already has an account. Sign in instead.")
      selectAuthTab("signin")
      return
    }
    if (code === "auth/weak-password") {
      fail(error, "Use a password of at least 8 characters.")
      return
    }
    if (code === "auth/invalid-email") {
      fail(error, "That email address doesn’t look right.")
      return
    }
    fail(error, "Couldn’t create the account. Try again.")
    return
  }
  try {
    await updateProfile(credential.user, { displayName: `${firstName} ${lastName}`.trim() })
  } catch {
    // Non-fatal: the account exists; the name still reaches the gateway below.
  }
  pendingSignupNames = { firstName, lastName }
  if (await afterFirebase()) goAuthed()
})

document.getElementById("invite-form")?.addEventListener("submit", async (event) => {
  event.preventDefault()
  const error = document.getElementById("login-error")
  error.hidden = true
  // No-Firebase gateways only: validate the operator-issued account code.
  // With Firebase, the session mints the account automatically.
  const value = document.getElementById("code").value.trim()
  const response = await fetch("/v1/invite/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: value }),
  })
  const data = await response.json()
  if (!data.valid) {
    fail(error, "That code doesn’t work.")
    return
  }
  localStorage.setItem(KEY, value)
  goAuthed()
})

document.getElementById("mint-form")?.addEventListener("submit", async (event) => {
  event.preventDefault()
  const error = document.getElementById("admin-error")
  error.hidden = true
  const count = Number(document.getElementById("mint-count").value)
  const cap_usd = Number(document.getElementById("mint-cap").value)
  const days = Number(document.getElementById("mint-days").value)
  const note = document.getElementById("mint-note").value.trim()
  const response = await fetch("/v1/admin/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await headers()) },
    body: JSON.stringify({ count, cap_usd, days, note }),
  })
  const data = await response.json()
  if (response.status !== 200 || !data.codes?.length) {
    fail(error, "Couldn’t mint codes.")
    return
  }
  const minted = document.getElementById("minted")
  minted.hidden = false
  const email = looksLikeEmail(note) ? note : ""
  const name = email ? "" : note
  document.getElementById("minted-codes").textContent = data.codes
    .map((code) => inviteMail({ email, name, code, capUsd: cap_usd, days }))
    .join("\n\n")
  document.getElementById("mint-note").value = ""
  void loadAdmin()
})

document.getElementById("copy-mint-mail")?.addEventListener("click", async (event) => {
  const ok = await copyText(document.getElementById("minted-codes").textContent)
  if (ok) flashCopied(event.currentTarget)
})

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function inviteMail(input) {
  const name = String(input.name || "").trim()
  const greeting = name ? `Hi ${name},` : "Hi,"
  const cap = Number(input.capUsd)
  const dollars = Number.isFinite(cap) ? (Number.isInteger(cap) ? String(cap) : cap.toFixed(2)) : "5"
  const days = Number(input.days) || 30
  const to = input.email ? `To: ${input.email}\n` : ""
  return `${to}Subject: Your Grist account

${greeting}

Your Grist account code is:

${input.code}

It includes $${dollars} of inference and lasts ${days} days.

Sign in at https://grist.lol/login with Google, then enter this code. You only do that once.

Install:
npm install -g grist-ai
grist

Pick Grist when it asks you to sign in. Your code stays on your machine.

— Grist
`
}

document.getElementById("admin-invites")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-revoke]")
  if (!button) return
  const code = button.getAttribute("data-revoke")
  await fetch(`/v1/admin/invites/${encodeURIComponent(code)}`, {
    method: "DELETE",
    headers: await headers(),
  })
  void loadAdmin()
})

document.getElementById("cap-form")?.addEventListener("submit", async (event) => {
  event.preventDefault()
  const msg = document.getElementById("cap-msg")
  const value = Number(document.getElementById("cap-input").value)
  msg.textContent = "Saving…"
  try {
    const response = await fetch("/v1/account/cap", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await headers()) },
      body: JSON.stringify({ cap_usd: value }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      msg.textContent = typeof data.error === "string" ? data.error : `Couldn’t update the cap (HTTP ${response.status}).`
      return
    }
    msg.textContent = `Cap updated to $${Number(data.cap_usd).toFixed(2)}.`
    await loadDashboard()
  } catch {
    msg.textContent = "Couldn’t reach the gateway."
  }
})

document.getElementById("key-form")?.addEventListener("submit", async (event) => {
  event.preventDefault()
  const error = document.getElementById("dash-error")
  error.hidden = true
  const name = document.getElementById("key-name").value.trim()
  const response = await fetch("/v1/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await headers()) },
    body: JSON.stringify({ name }),
  })
  const data = await response.json()
  if (response.status !== 200 || !data.key) {
    fail(error, data.error === "key limit reached" ? "Twenty keys is the limit. Revoke one first." : "Couldn’t create a key.")
    return
  }
  document.getElementById("key-name").value = ""
  const panel = document.getElementById("key-secret")
  panel.hidden = false
  document.getElementById("key-secret-value").textContent = data.key
  void loadApiKeys()
})

document.getElementById("key-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-revoke-key]")
  if (!button) return
  const id = button.getAttribute("data-revoke-key")
  await fetch(`/v1/api-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await headers(),
  })
  document.getElementById("key-secret").hidden = true
  void loadApiKeys()
})

document.getElementById("copy-key")?.addEventListener("click", async (event) => {
  const node = event.currentTarget
  const ok = await copyText(document.getElementById("key-secret-value").textContent)
  if (!ok) return
  flashCopied(node)
})

let modelsLoad = 0

async function loadModels() {
  const gen = ++modelsLoad
  const error = document.getElementById("dash-error")
  const response = await fetch("/v1/rung-models", { headers: await headers() })
  if (gen !== modelsLoad) return
  if (response.status !== 200) {
    fail(error, "Couldn’t load models. Sign in again.")
    return
  }
  const data = await response.json()
  renderModels(data.rungs ?? [])
}

function renderModels(rungs) {
  document.getElementById("model-rows").innerHTML = rungs
    .map(
      (row) => `
      <div class="model-row">
        <div class="model-row-head">
          <strong>${escapeHtml(row.label)}</strong>
          <code>${escapeHtml(row.rung)}</code>
          ${row.override ? `<span class="pill">custom</span>` : `<span class="pill pill-dim">default</span>`}
        </div>
        <p class="muted">Default <code>${escapeHtml(row.default.model)}</code></p>
        <input data-rung="${escapeHtml(row.rung)}" value="${escapeHtml(row.override ?? "")}"
          placeholder="${escapeHtml(row.default.model)}" autocomplete="off" spellcheck="false"
          aria-label="${escapeHtml(row.label)} model override" />
      </div>`,
    )
    .join("")
}

async function putRungModels(overrides) {
  const msg = document.getElementById("models-msg")
  msg.textContent = ""
  const response = await fetch("/v1/rung-models", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await headers()) },
    body: JSON.stringify({ overrides }),
  })
  const data = await response.json().catch(() => ({}))
  if (response.status !== 200) {
    msg.textContent = data.error ?? "Couldn’t save models."
    return
  }
  renderModels(data.rungs ?? [])
  msg.textContent = "Saved."
}

function collectRungModels() {
  const overrides = {}
  for (const input of document.querySelectorAll("#model-rows input[data-rung]")) {
    const value = input.value.trim()
    overrides[input.getAttribute("data-rung")] = value ? value : null
  }
  return overrides
}

document.getElementById("models-form")?.addEventListener("submit", (event) => {
  event.preventDefault()
  void putRungModels(collectRungModels())
})

document.getElementById("models-reset")?.addEventListener("click", () => {
  const overrides = {}
  for (const input of document.querySelectorAll("#model-rows input[data-rung]")) {
    overrides[input.getAttribute("data-rung")] = null
  }
  void putRungModels(overrides)
})

document.getElementById("copy-skill")?.addEventListener("click", async (event) => {
  const node = event.currentTarget
  const response = await fetch("/grist-skill.md")
  if (!response.ok) return
  const ok = await copyText(await response.text())
  if (!ok) return
  flashCopied(node)
})

async function signOutLocal() {
  localStorage.removeItem(KEY)
  state.admin = false
  state.sessionKnown = false
  if (state.auth) await signOut(state.auth)
  showAuthStep()
}

for (const node of document.querySelectorAll(".sign-out")) {
  node.addEventListener("click", async () => {
    await signOutLocal()
    history.pushState(null, "", "/")
    render()
  })
}

const NPM_INSTALL = "npm install -g grist-ai\ngrist"

const SKILLS_INSTALL = "npx skills add grist-ai/grist-skills"

const AGENT_PROMPT = `Use Grist for my coding tasks from now on. Grist is an agentic coding-harness CLI.

1. Install the Grist agent skill by running: npx skills add grist-ai/grist-skills (built for personal AI agents and agentic CLIs like Muse, OpenClaw, Hermes, and OpenCode). Read the installed skill file in full before doing anything else.
2. Install the CLI if it is missing: npm install -g grist-ai.
3. Ask me for my Grist API key if you do not have it (it starts with grist_sk_). Never print it, log it, or write it into any file — pass it via environment variable only.
4. For multi-step coding work (features, bug fixes, refactors across files), delegate to Grist exactly as the skill describes. Report back what changed, the branch name, test results, and cost.`

const COPIES = {
  npm: NPM_INSTALL,
  skills: SKILLS_INSTALL,
  agent: AGENT_PROMPT,
}

for (const node of document.querySelectorAll("[data-fold]")) {
  node.addEventListener("click", () => {
    const box = node.closest(".hero-install")
    if (!box) return
    const open = box.classList.toggle("is-open")
    node.setAttribute("aria-expanded", open ? "true" : "false")
    node.textContent = open ? "Show less" : "Read more"
  })
}

for (const node of document.querySelectorAll("[data-copy]")) {
  node.addEventListener("click", async () => {
    const key = node.getAttribute("data-copy") || "npm"
    const text = COPIES[key] || key
    const ok = await copyText(text)
    if (!ok) return
    flashCopied(node)
  })
}

function flashCopied(node) {
  node.dataset.copied = "true"
  const label = node.textContent
  node.textContent = "Copied"
  setTimeout(() => {
    delete node.dataset.copied
    node.textContent = label
  }, 1400)
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const field = document.createElement("textarea")
    field.value = text
    field.setAttribute("readonly", "")
    field.style.position = "fixed"
    field.style.left = "-9999px"
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand("copy")
    field.remove()
    return ok
  }
}

window.addEventListener("popstate", () => void render())
document.querySelectorAll('a[href^="/"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const href = link.getAttribute("href")
    if (!href || href.startsWith("/v1") || href.endsWith(".md")) return
    event.preventDefault()
    history.pushState(null, "", href)
    void render()
  })
})

await bootFirebase()
state.ready = true
await render()
