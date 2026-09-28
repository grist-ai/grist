import { createHash } from "node:crypto"

/** Crockford base32 without I, L, O, U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

function randomCrockford(n: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  return Array.from(bytes, (b) => ALPHABET[b! % 32]!).join("")
}

/** Agent API keys look like `grist_sk_` plus 64 hex chars. */
export function generateApiKeySecret(): string {
  return `grist_sk_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`
}

/**
 * Muse connector tokens look like `grist_mcn_` plus 64 hex chars. They are
 * API keys with a scoped kind: they can route, complete, and read spend, but
 * can never touch provider keys.
 */
export function generateConnectorSecret(): string {
  return `grist_mcn_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`
}

export function generateApiKeyId(): string {
  return `gsk_${randomCrockford(12)}`
}

export function canonicalApiKey(raw: string): string | undefined {
  const value = raw.trim().toLowerCase()
  if (!/^grist_(sk|mcn)_[0-9a-f]{64}$/.test(value)) return
  return value
}

export function apiKeyPrefix(secret: string): string {
  return `${secret.slice(0, 16)}…`
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex")
}

/** Invite codes look like `grist-XXXX-XXXX`. */
export function generateInviteCode(): string {
  const chars = randomCrockford(8)
  return `grist-${chars.slice(0, 4)}-${chars.slice(4)}`
}

/** Short code shown in the CLI login URL (`XXXX-XXXX`). */
export function generateDeviceUserCode(): string {
  const chars = randomCrockford(8)
  return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

export function generateDeviceSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")
}

/** Fold I/L→1 and O→0 on an 8-char device user code. */
export function canonicalDeviceUserCode(raw: string): string | undefined {
  const rest = raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0")
  if (rest.length !== 8) return
  if (![...rest].every((c) => ALPHABET.includes(c))) return
  return `${rest.slice(0, 4)}-${rest.slice(4)}`
}

/**
 * Canonicalize user input: strip separators, fold I/L→1 and O→0.
 * Returns undefined when the shape is not a Grist invite code.
 */
export function canonicalInviteCode(raw: string): string | undefined {
  const compact = raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, "")
  if (!compact.startsWith("GRIST")) return
  const rest = compact.slice(5).replace(/[IL]/g, "1").replace(/O/g, "0")
  if (rest.length !== 8) return
  if (![...rest].every((c) => ALPHABET.includes(c))) return
  return `grist-${rest.slice(0, 4)}-${rest.slice(4)}`
}
