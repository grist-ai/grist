import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PRODUCT_GATEWAY_URL } from "../../brand"

export type InviteConfig = {
  code: string
  gatewayUrl: string
}

export type AccountStatus = {
  signedIn: boolean
  gatewayUrl: string
}

export type AccountUsage = {
  spent_usd: number
  cap_usd: number
  remaining_usd: number
  plan: string
  expires_at: string
  by_rung: { cheapest: number; medium: number; frontier: number }
}

export type AccountLoginStart = {
  userCode: string
}

export type AccountLoginResult = { ok: true } | { ok: false; reason: "expired" | "unreachable" | "cancelled" }

type PendingLogin = {
  abort: AbortController
  deviceCode: string
  gatewayUrl: string
  interval: number
  deadline: number
}

let pending: PendingLogin | undefined

export function inviteConfigPath() {
  return process.env.GRIST_CONFIG_PATH?.trim() || path.join(os.homedir(), ".grist", "config.json")
}

export function accountStatus(): AccountStatus {
  const config = loadInviteConfig()
  return {
    signedIn: !!config,
    gatewayUrl: config?.gatewayUrl || resolveGatewayUrl(),
  }
}

export function logout() {
  cancelLogin()
  const file = inviteConfigPath()
  if (fs.existsSync(file)) fs.rmSync(file)
}

export async function startLogin(openUrl: (url: string) => void): Promise<AccountLoginStart> {
  cancelLogin()
  const gatewayUrl = resolveGatewayUrl()
  const response = await fetch(`${gatewayUrl}/v1/auth/device`, { method: "POST" }).catch(() => undefined)
  if (!response?.ok) throw new Error("unreachable")
  const login = (await response.json()) as {
    device_code?: string
    user_code?: string
    verification_uri?: string
    interval?: number
    expires_in?: number
  }
  if (!login.device_code || !login.user_code || !login.verification_uri) throw new Error("unreachable")
  pending = {
    abort: new AbortController(),
    deviceCode: login.device_code,
    gatewayUrl,
    interval: Math.max(1, login.interval || 1),
    deadline: Date.now() + Math.max(30, login.expires_in || 600) * 1000,
  }
  openUrl(`${gatewayUrl}${login.verification_uri}`)
  return { userCode: login.user_code }
}

export async function waitLogin(): Promise<AccountLoginResult> {
  const current = pending
  if (!current) return { ok: false, reason: "cancelled" }
  const { abort, deviceCode, gatewayUrl, interval, deadline } = current
  while (!abort.signal.aborted) {
    if (Date.now() >= deadline) {
      if (pending === current) pending = undefined
      return { ok: false, reason: "expired" }
    }
    await sleep(interval * 1000, abort.signal).catch(() => undefined)
    if (abort.signal.aborted || pending !== current) return { ok: false, reason: "cancelled" }
    const next = await pollDevice(gatewayUrl, deviceCode).catch(() => undefined)
    if (!next) return { ok: false, reason: "unreachable" }
    if (next.status === "pending") continue
    if (pending === current) pending = undefined
    if (next.status !== "approved" || !next.code) return { ok: false, reason: "expired" }
    saveInviteConfig({ code: next.code, gatewayUrl })
    return { ok: true }
  }
  return { ok: false, reason: "cancelled" }
}

export function cancelLogin() {
  pending?.abort.abort()
  pending = undefined
}

export async function fetchUsage(): Promise<AccountUsage> {
  const config = loadInviteConfig()
  if (!config) throw new Error("signed-out")
  const response = await fetch(`${config.gatewayUrl}/v1/usage`, {
    headers: { "X-Grist-Invite": config.code },
  }).catch(() => undefined)
  if (!response?.ok) throw new Error(response?.status === 401 ? "signed-out" : "unreachable")
  return (await response.json()) as AccountUsage
}

export function plansUrl() {
  return `${accountStatus().gatewayUrl}/plans`
}

export function loadInviteConfig(): InviteConfig | undefined {
  const envCode = process.env.GRIST_INVITE?.trim()
  const envUrl = process.env.GRIST_GATEWAY_URL?.trim()
  const file = readConfigFile()
  const code = envCode || file?.code || ""
  const gatewayUrl = strip(envUrl || file?.gatewayUrl || "")
  if (!code || !gatewayUrl) return
  return { code, gatewayUrl }
}

function saveInviteConfig(config: InviteConfig) {
  const gatewayUrl = strip(config.gatewayUrl)
  if (!config.code || !gatewayUrl) throw new Error("invalid invite")
  const file = inviteConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ code: config.code, gatewayUrl }, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

function readConfigFile(): Partial<InviteConfig> | undefined {
  const file = inviteConfigPath()
  if (!fs.existsSync(file)) return
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown
  if (!parsed || typeof parsed !== "object") return
  const rec = parsed as Record<string, unknown>
  return {
    code: typeof rec.code === "string" ? rec.code : undefined,
    gatewayUrl: typeof rec.gatewayUrl === "string" ? rec.gatewayUrl : undefined,
  }
}

function resolveGatewayUrl() {
  return strip(process.env.GRIST_GATEWAY_URL?.trim() || loadInviteConfig()?.gatewayUrl || PRODUCT_GATEWAY_URL)
}

async function pollDevice(gatewayUrl: string, device_code: string) {
  const response = await fetch(`${gatewayUrl}/v1/auth/device/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code }),
  })
  return (await response.json()) as { status: string; code?: string }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("cancelled"))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new Error("cancelled"))
      },
      { once: true },
    )
  })
}

function strip(url: string) {
  return url.replace(/\/+$/, "")
}
