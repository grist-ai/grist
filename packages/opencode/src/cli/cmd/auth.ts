import readline from "node:readline"
import open from "open"
import { UI } from "../ui"
import { canonicalApiKey } from "@/grist/gateway/codes"
import { fetchUsage, pollCliLogin, startCliLogin } from "@/grist/invite/client"
import {
  clearInviteConfig,
  DEFAULT_GATEWAY_URL,
  loadInviteConfig,
  saveAuthConfig,
  saveInviteConfig,
} from "@/grist/invite/config"

function strip(url: string) {
  return url.replace(/\/+$/, "")
}

export function resolveGateway(arg?: string) {
  return strip(
    arg?.trim() || process.env.GRIST_GATEWAY_URL?.trim() || loadInviteConfig()?.gatewayUrl || DEFAULT_GATEWAY_URL,
  )
}

export function canPromptLogin() {
  return Boolean(process.stdin.isTTY && (process.stdout.isTTY || process.stderr.isTTY))
}

export async function runAuthLogin(gateway?: string) {
  const gatewayUrl = resolveGateway(gateway)
  if (!gatewayUrl) return { ok: false as const, reason: "unreachable" as const }

  const login = await startCliLogin(gatewayUrl).catch(() => undefined)
  if (!login) return { ok: false as const, reason: "unreachable" as const }

  const url = `${gatewayUrl}${login.verification_uri}`
  UI.println("Opening " + url)
  await open(url).catch(() => undefined)
  UI.println("Waiting for you to log in on the site…")

  const deadline = Date.now() + login.expires_in * 1000
  const interval = Math.max(1, login.interval || 1) * 1000
  while (Date.now() < deadline) {
    await Bun.sleep(interval)
    const next = await pollCliLogin(gatewayUrl, login.device_code).catch(() => undefined)
    if (!next) return { ok: false as const, reason: "unreachable" as const }
    if (next.status === "pending") continue
    if (next.status !== "approved") return { ok: false as const, reason: "expired" as const }
    saveInviteConfig({ code: next.code, gatewayUrl })
    return { ok: true as const, gatewayUrl, code: next.code }
  }
  return { ok: false as const, reason: "expired" as const }
}

export async function runAuthApiKey(input: { key: string; gatewayUrl?: string }) {
  const key = canonicalApiKey(input.key)
  if (!key) return { ok: false as const, reason: "invalid" as const }
  const gatewayUrl = resolveGateway(input.gatewayUrl)
  try {
    await fetchUsage({ code: key, gatewayUrl, kind: "api_key" })
  } catch {
    return { ok: false as const, reason: "unauthorized" as const }
  }
  saveAuthConfig({ code: key, gatewayUrl })
  return { ok: true as const, key, gatewayUrl }
}

export async function ensureSignedIn(gateway?: string) {
  if (loadInviteConfig()) return true
  if (!canPromptLogin()) return false
  UI.println("First run. Grist needs you signed in.")
  const yes = await promptYes("Open login in your browser?")
  if (!yes) return false
  const result = await runAuthLogin(gateway)
  if (result.ok) {
    UI.println("Logged in")
    return true
  }
  if (result.reason === "expired") UI.error("Login expired. Run grist auth login again.")
  if (result.reason === "unreachable") UI.error("Could not reach the Grist site.")
  return false
}

export function forgetGristLogin() {
  clearInviteConfig()
}

function promptYes(question: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise<boolean>((resolve) => {
    rl.question(`${question} [Y/n] `, (answer) => {
      rl.close()
      const text = answer.trim().toLowerCase()
      resolve(text === "" || text === "y" || text === "yes")
    })
  })
}
