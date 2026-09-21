import fs from "fs"
import os from "os"
import path from "path"
import { canonicalInviteCode } from "../gateway/codes"

export type InviteConfig = {
  code: string
  gatewayUrl: string
}

export const DEFAULT_GATEWAY_URL = "https://grist.lol"

export function inviteConfigPath() {
  return process.env.GRIST_CONFIG_PATH?.trim() || path.join(os.homedir(), ".grist", "config.json")
}

export const INVITE_REQUIRED_MESSAGE = "Grist needs you signed in. Run: grist auth login"

export function loadInviteConfig(): InviteConfig | undefined {
  const envCode = process.env.GRIST_INVITE?.trim()
  const envUrl = process.env.GRIST_GATEWAY_URL?.trim()
  const file = readConfigFile()
  const code = canonicalInviteCode(envCode || file?.code || "")
  const gatewayUrl = stripSlash(envUrl || file?.gatewayUrl || "")
  if (!code || !gatewayUrl) return
  return { code, gatewayUrl }
}

export function saveInviteConfig(config: InviteConfig) {
  const code = canonicalInviteCode(config.code)
  if (!code) throw new Error("invalid invite code")
  const gatewayUrl = stripSlash(config.gatewayUrl)
  if (!gatewayUrl) throw new Error("gateway URL required")
  const file = inviteConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ code, gatewayUrl }, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

export function clearInviteConfig() {
  const file = inviteConfigPath()
  if (fs.existsSync(file)) fs.rmSync(file)
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

function stripSlash(url: string) {
  return url.replace(/\/+$/, "")
}
