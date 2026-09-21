import fs from "fs"
import os from "os"
import path from "path"
import { canonicalApiKey, canonicalInviteCode } from "../gateway/codes"

export type InviteConfig = {
  code: string
  gatewayUrl: string
  kind: "invite" | "api_key"
}

export const DEFAULT_GATEWAY_URL = "https://grist.lol"

export function inviteConfigPath() {
  return process.env.GRIST_CONFIG_PATH?.trim() || path.join(os.homedir(), ".grist", "config.json")
}

export const INVITE_REQUIRED_MESSAGE = "Grist needs you signed in. Run: grist auth login"

export function loadInviteConfig(): InviteConfig | undefined {
  const envUrl = process.env.GRIST_GATEWAY_URL?.trim()
  const file = readConfigFile()
  const gatewayFromEnvOrFile = stripSlash(envUrl || file?.gatewayUrl || "")

  const envKey = canonicalApiKey(process.env.GRIST_API_KEY ?? "")
  if (envKey) {
    return { code: envKey, gatewayUrl: gatewayFromEnvOrFile || DEFAULT_GATEWAY_URL, kind: "api_key" }
  }

  const code = canonicalInviteCode(process.env.GRIST_INVITE?.trim() || file?.code || "")
  const gatewayUrl = gatewayFromEnvOrFile
  if (!code || !gatewayUrl) return
  return { code, gatewayUrl, kind: "invite" }
}

export function gatewayAuthHeaders(config: InviteConfig): Record<string, string> {
  switch (config.kind) {
    case "api_key":
      return { "X-Grist-Api-Key": config.code }
    case "invite":
      return { "X-Grist-Invite": config.code }
    default: {
      const exhaustive: never = config.kind
      throw new Error(`unhandled auth kind: ${exhaustive}`)
    }
  }
}

export function saveInviteConfig(config: { code: string; gatewayUrl: string }) {
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
