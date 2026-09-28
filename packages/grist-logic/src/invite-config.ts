import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { canonicalApiKey, canonicalInviteCode } from "./codes.js"

export type InviteConfig = {
  code: string
  gatewayUrl: string
  kind: "invite" | "api_key"
}

export const DEFAULT_GATEWAY_URL = "https://grist.lol"

export function inviteConfigPath() {
  return process.env.GRIST_CONFIG_PATH?.trim() || path.join(os.homedir(), ".grist", "config.json")
}

export const INVITE_REQUIRED_MESSAGE = "Grist needs you signed in. Run: grist auth login --provider grist"

/**
 * Persist a Grist credential (API key or invite code) plus the gateway URL to
 * the user's config file. Merges with any existing keys and locks the file
 * down to owner-only permissions, since it holds a bearer credential.
 */
export function writeInviteConfig(input: { code: string; gatewayUrl: string }) {
  const file = inviteConfigPath()
  const existing = readConfigFile() ?? {}
  const next = { ...existing, code: input.code, gatewayUrl: input.gatewayUrl }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n")
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // non-POSIX filesystems: best effort
  }
  return file
}

export function loadInviteConfig(): InviteConfig | undefined {
  const envUrl = process.env.GRIST_GATEWAY_URL?.trim()
  const file = readConfigFile()
  const gatewayFromEnvOrFile = stripSlash(envUrl || file?.gatewayUrl || "")

  const envKey = canonicalApiKey(process.env.GRIST_API_KEY ?? "")
  const fileKey = canonicalApiKey(file?.code ?? "")
  const key = envKey ?? fileKey
  if (key) {
    return { code: key, gatewayUrl: gatewayFromEnvOrFile || DEFAULT_GATEWAY_URL, kind: "api_key" }
  }

  const code = canonicalInviteCode(process.env.GRIST_INVITE?.trim() || file?.code || "")
  const gatewayUrl = gatewayFromEnvOrFile
  if (!code || !gatewayUrl) return
  return { code, gatewayUrl, kind: "invite" }
}

export function gatewayAuthHeaders(config: InviteConfig): Record<string, string> {
  if (config.kind === "api_key") return { "X-Grist-Api-Key": config.code }
  return { "X-Grist-Invite": config.code }
}

function stripSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url
}

function readConfigFile(): Partial<InviteConfig> | undefined {
  const file = inviteConfigPath()
  if (!fs.existsSync(file)) return
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return
  }
}
