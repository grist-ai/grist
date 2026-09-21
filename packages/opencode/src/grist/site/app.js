import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js"

const KEY = "grist_invite"
const state = { auth: undefined, ready: false, admin: false }

const views = {
  "/": "view-home",
  "/login": "view-login",
  "/dashboard": "view-dashboard",
  "/dashboard/api": "view-dashboard",
  "/admin": "view-admin",
  "/plans": "view-plans",
  "/docs": "view-docs",
  "/docs/skills": "view-docs-skills",
  "/privacy": "view-privacy",
  "/terms": "view-terms",
  "/acceptable-use": "view-acceptable-use",
  "/cookies": "view-cookies",
}

const titles = {
  "/": "Grist — the coding agent that learns your codebase",
  "/login": "Sign in — Grist",
  "/dashboard": "Usage — Grist",
  "/dashboard/api": "API keys — Grist",
  "/admin": "Admin — Grist",
  "/plans": "Plans — Grist",
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
  document.getElementById("login-who").hidden = true
  document.getElementById("firebase-missing").hidden = true
  setLoginCopy({
    kicker: "[ sign in ]",
    title: "Sign in",
    lede: "Sign in with Google. First time, enter your invite. After that, this account is enough.",
  })
}

function showInviteStep(email) {
  document.getElementById("login-methods").hidden = true
  document.getElementById("invite-form").hidden = false
  document.getElementById("switch-account").hidden = !state.auth?.currentUser
  document.getElementById("firebase-missing").hidden = true
  const who = document.getElementById("login-who")
  who.hidden = !email
  if (email) who.textContent = `Signed in as ${email}. First time only — this account keeps the invite.`
  setLoginCopy({
    kicker: "[ invite ]",
    title: "Enter your invite",
    lede: "New accounts need a code. After this, Sign in with Google will not ask again.",
  })
}

function showInviteOnly() {
  document.getElementById("login-methods").hidden = true
  document.getElementById("invite-form").hidden = false
  document.getElementById("switch-account").hidden = true
  document.getElementById("login-who").hidden = true
  document.getElementById("firebase-missing").hidden = false
  setLoginCopy({
    kicker: "[ invite ]",
    title: "Enter your invite",
    lede: "Google sign-in is not configured on this gateway yet. Paste the code you were given.",
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
    await new Promise((resolve) => {
      onAuthStateChanged(state.auth, () => resolve())
    })
  } catch {
    showInviteOnly()
  }
}

async function afterFirebase() {
  const user = state.auth?.currentUser
  if (!user) {
    state.admin = false
    showAuthStep()
    return false
  }
  const response = await fetch("/v1/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: await user.getIdToken() }),
  })
  const data = await response.json()
  if (!data.ok) return false
  state.admin = Boolean(data.admin)
  if (data.code) localStorage.setItem(KEY, data.code)
  if (data.admin) return true
  if (data.needs_invite) {
    showInviteStep(data.email || user.email)
    return false
  }
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
  const user = state.auth?.currentUser
  if (user) return { Authorization: `Bearer ${await user.getIdToken()}` }
  if (invite()) return { "X-Grist-Invite": invite() }
  return {}
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
  history.pushState(null, "", state.admin ? "/admin" : "/dashboard")
  render()
}

async function render() {
  const path = pathOf()
  if (path === "/login" && state.auth?.currentUser && !device() && (await afterFirebase())) {
    history.replaceState(null, "", state.admin ? "/admin" : "/dashboard")
    show(state.admin ? "view-admin" : "view-dashboard")
    setAuthNav()
    if (state.admin) {
      void loadAdmin()
      return
    }
    setDashTab("usage")
    void loadDashboard()
    return
  }
  if (path === "/admin") {
    if (!state.admin && state.auth?.currentUser) await afterFirebase()
    if (!state.admin) {
      history.replaceState(null, "", "/login")
      show("view-login")
      setAuthNav()
      return
    }
    show("view-admin")
    setAuthNav()
    void loadAdmin()
    return
  }
  if (path === "/dashboard" || path === "/dashboard/api") {
    if (!signedIn()) {
      history.replaceState(null, "", "/login")
      show("view-login")
      setAuthNav()
      return
    }
    show("view-dashboard")
    setDashTab(path === "/dashboard/api" ? "api" : "usage")
    setAuthNav()
    void loadDashboard()
    if (path === "/dashboard/api") void loadApiKeys()
    return
  }
  if (path === "/login" && device() && invite()) {
    setAuthNav()
    void finishCliLogin(invite())
    return
  }
  show(views[path] ?? "view-home")
  setAuthNav()
  loadWaitlist()
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

function loadWaitlist() {
  const tally = globalThis.Tally
  if (tally) {
    tally.loadEmbeds()
    return
  }
  document.querySelectorAll("iframe[data-tally-src]:not([src])").forEach((frame) => {
    frame.src = frame.dataset.tallySrc
  })
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
        ? "Invite spend cap reached. Ask the founder for a top-up."
        : "Sign in again, then bind your invite.",
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
  const rungs = data.by_rung ?? {}
  document.getElementById("rungs").innerHTML = ["cheapest", "medium", "frontier"]
    .map((name) => `<div><strong>${name}</strong>$${(rungs[name] ?? 0).toFixed(2)}</div>`)
    .join("")
  document.getElementById("cli").textContent =
    `grist auth login --provider grist --gateway ${window.location.origin}`
}

function setDashTab(tab) {
  const api = tab === "api"
  document.getElementById("dash-title").textContent = api ? "API keys" : "Usage"
  document.getElementById("dash-panel-usage").hidden = api
  document.getElementById("dash-panel-api").hidden = !api
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
    fail(error, "Admin session expired. Sign in again.")
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

document.getElementById("google-btn")?.addEventListener("click", async () => {
  const error = document.getElementById("login-error")
  error.hidden = true
  if (!state.auth) {
    fail(error, "Firebase is not configured.")
    return
  }
  try {
    await signInWithPopup(state.auth, new GoogleAuthProvider())
  } catch (err) {
    const code = typeof err?.code === "string" ? err.code : ""
    if (code === "auth/unauthorized-domain") {
      fail(error, "This site isn’t on the Firebase authorized domains list.")
      return
    }
    if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user") {
      fail(error, "Google popup was blocked or closed. Allow popups and try again.")
      return
    }
    if (code === "auth/operation-not-allowed") {
      fail(error, "Google sign-in isn’t enabled yet. Use email.")
      return
    }
    fail(error, "Google sign-in failed. Use email, or try again.")
    return
  }
  if (await afterFirebase()) goAuthed()
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
  } catch {
    await createUserWithEmailAndPassword(state.auth, email, password)
  }
  if (await afterFirebase()) goAuthed()
})

document.getElementById("invite-form")?.addEventListener("submit", async (event) => {
  event.preventDefault()
  const error = document.getElementById("login-error")
  error.hidden = true
  const value = document.getElementById("code").value.trim()
  const user = state.auth?.currentUser
  if (user) {
    const response = await fetch("/v1/auth/session/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: await user.getIdToken(), code: value }),
    })
    const data = await response.json()
    if (!data.ok) {
      fail(error, "That code doesn’t work.")
      return
    }
    localStorage.setItem(KEY, value)
    goAuthed()
    return
  }
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
  document.getElementById("minted-codes").textContent = data.codes.join("\n")
  document.getElementById("mint-note").value = ""
  void loadAdmin()
})

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

document.getElementById("switch-account")?.addEventListener("click", async () => {
  document.getElementById("login-error").hidden = true
  await signOutLocal()
  setAuthNav()
})

const NPM_INSTALL = "npm install -g grist-ai\ngrist"

const SKILLS_INSTALL = "npx skills add grist-ai/grist-skills"

const COPIES = {
  npm: NPM_INSTALL,
  skills: SKILLS_INSTALL,
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
