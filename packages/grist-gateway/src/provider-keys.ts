/** Encrypted storage for per-user BYOK provider keys.
 *
 * Provider keys are encrypted at rest with AES-256-GCM under a single master
 * key (`GRIST_MASTER_KEY`, 32 bytes as 64 hex chars or base64). The gateway
 * decrypts only in memory when building an upstream request — keys are never
 * logged and no API ever returns one. Without a master key the credential
 * methods fail closed.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * Parse the master key from env. Accepts 64 hex chars or base64 encoding 32
 * bytes. Anything else (including passphrases) returns undefined — generate
 * with `openssl rand -hex 32` and store the 64 hex chars.
 */
export function parseMasterKey(raw?: string): Buffer | undefined {
  const text = raw?.trim()
  if (!text) return undefined
  if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, "hex")
  try {
    const bytes = Buffer.from(text, "base64")
    if (bytes.length === 32) return bytes
  } catch {
    // fall through to undefined
  }
  return undefined
}

/** SHA-256 hex of the raw key — safe to display, identifies the key in use. */
export function fingerprintKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex")
}

/** Encrypt a provider key. Blob layout: base64(iv || authTag || ciphertext). */
export function encryptProviderKey(rawKey: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv)
  const ciphertext = Buffer.concat([cipher.update(rawKey, "utf8"), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")
}

/** Decrypt a blob from `encryptProviderKey`. Throws on tamper or wrong key. */
export function decryptProviderKey(blob: string, masterKey: Buffer): string {
  const bytes = Buffer.from(blob, "base64")
  const iv = bytes.subarray(0, IV_BYTES)
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}
