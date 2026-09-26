/** Agent API keys look like `grist_sk_` plus 64 hex chars. */
export function canonicalApiKey(raw: string): string | undefined {
  const value = raw.trim().toLowerCase()
  if (!/^grist_sk_[0-9a-f]{64}$/.test(value)) return
  return value
}

/** Invite codes look like `grist-XXXX-XXXX`. */
export function canonicalInviteCode(raw: string): string | undefined {
  const value = raw.trim().toUpperCase()
  if (!/^GRIST-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(value)) return
  return value
}
