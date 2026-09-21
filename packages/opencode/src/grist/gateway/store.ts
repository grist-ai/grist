import { Database } from "bun:sqlite"
import type { OperatingMode } from "../mode"
import type { Rung } from "../rung"
import {
  apiKeyPrefix,
  canonicalApiKey,
  canonicalDeviceUserCode,
  canonicalInviteCode,
  generateApiKeyId,
  generateApiKeySecret,
  generateDeviceSecret,
  generateDeviceUserCode,
  generateInviteCode,
  hashApiKey,
} from "./codes"

export type AccountRow = {
  firebase_uid: string
  invite_code: string
  email: string | null
  created_at: number
}

export type CliLoginRow = {
  device_code: string
  user_code: string
  invite_code: string | null
  expires_at: number
  created_at: number
}

export type InviteRow = {
  code: string
  cap_usd: number
  spent_usd: number
  expires_at: number
  revoked: number
  note: string | null
  created_at: number
}

export type UsageRow = {
  code: string
  at: number
  model: string
  rung: Rung
  input_tokens: number
  output_tokens: number
  usd: number
}

export type ApiKeyRow = {
  id: string
  invite_code: string
  hash: string
  prefix: string
  name: string
  created_at: number
  last_used_at: number | null
  revoked: number
}

export type PublicApiKey = {
  id: string
  name: string
  prefix: string
  created_at: number
  last_used_at: number | null
  revoked: boolean
}

const DEFAULT_CAP = 5
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_API_KEYS = 20
const TOUCH_API_KEY_MS = 60_000

export function openGatewayStore(filePath = ":memory:") {
  const db = new Database(filePath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec(`
    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      cap_usd REAL NOT NULL,
      spent_usd REAL NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      at INTEGER NOT NULL,
      model TEXT NOT NULL,
      rung TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      usd REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS burn_in (
      id TEXT PRIMARY KEY,
      at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cli_logins (
      device_code TEXT PRIMARY KEY,
      user_code TEXT NOT NULL UNIQUE,
      invite_code TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      firebase_uid TEXT PRIMARY KEY,
      invite_code TEXT NOT NULL UNIQUE,
      email TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      invite_code TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS api_keys_invite ON api_keys(invite_code);
  `)

  const insertInvite = db.prepare(
    `INSERT INTO invites (code, cap_usd, spent_usd, expires_at, revoked, note, created_at)
     VALUES (?, ?, 0, ?, 0, ?, ?)`,
  )
  const selectInvite = db.prepare(`SELECT * FROM invites WHERE code = ?`)
  const revokeInvite = db.prepare(`UPDATE invites SET revoked = 1 WHERE code = ?`)
  const addSpent = db.prepare(`UPDATE invites SET spent_usd = spent_usd + ? WHERE code = ?`)
  const insertUsage = db.prepare(
    `INSERT INTO usage_events (code, at, model, rung, input_tokens, output_tokens, usd)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const usageByCode = db.prepare(`SELECT * FROM usage_events WHERE code = ? ORDER BY at ASC`)
  const hourlySpend = db.prepare(
    `SELECT COALESCE(SUM(usd), 0) AS total FROM usage_events WHERE code = ? AND at >= ?`,
  )
  const allInvites = db.prepare(`SELECT * FROM invites`)
  const countInvites = db.prepare(`SELECT COUNT(*) AS n FROM invites`)
  const getSetting = db.prepare(`SELECT value FROM settings WHERE key = ?`)
  const setSetting = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
  const insertBurnIn = db.prepare(`INSERT INTO burn_in (id, at, payload) VALUES (?, ?, ?)`)
  const insertCliLogin = db.prepare(
    `INSERT INTO cli_logins (device_code, user_code, invite_code, expires_at, created_at)
     VALUES (?, ?, NULL, ?, ?)`,
  )
  const selectCliByDevice = db.prepare(`SELECT * FROM cli_logins WHERE device_code = ?`)
  const selectCliByUser = db.prepare(`SELECT * FROM cli_logins WHERE user_code = ?`)
  const approveCli = db.prepare(`UPDATE cli_logins SET invite_code = ? WHERE user_code = ?`)
  const deleteCli = db.prepare(`DELETE FROM cli_logins WHERE device_code = ?`)
  const purgeCli = db.prepare(`DELETE FROM cli_logins WHERE expires_at <= ?`)
  const insertAccount = db.prepare(
    `INSERT INTO accounts (firebase_uid, invite_code, email, created_at) VALUES (?, ?, ?, ?)`,
  )
  const selectAccount = db.prepare(`SELECT * FROM accounts WHERE firebase_uid = ?`)
  const selectAccountByInvite = db.prepare(`SELECT * FROM accounts WHERE invite_code = ?`)
  const allAccounts = db.prepare(`SELECT invite_code, email FROM accounts`)
  const insertApiKey = db.prepare(
    `INSERT INTO api_keys (id, invite_code, hash, prefix, name, created_at, last_used_at, revoked)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
  )
  const selectApiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`)
  const selectApiKeyByHash = db.prepare(`SELECT * FROM api_keys WHERE hash = ?`)
  const selectApiKeysForInvite = db.prepare(`SELECT * FROM api_keys WHERE invite_code = ? ORDER BY created_at DESC`)
  const countActiveApiKeys = db.prepare(
    `SELECT COUNT(*) AS n FROM api_keys WHERE invite_code = ? AND revoked = 0`,
  )
  const markApiKeyRevoked = db.prepare(
    `UPDATE api_keys SET revoked = 1 WHERE id = ? AND invite_code = ? AND revoked = 0`,
  )
  const touchApiKey = db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`)

  function lookup(raw: string): InviteRow | undefined {
    const code = canonicalInviteCode(raw)
    if (!code) return
    return selectInvite.get(code) as InviteRow | undefined
  }

  return {
    createInvite(input?: { capUsd?: number; expiresAt?: number; note?: string }): InviteRow {
      const created_at = Date.now()
      const expires_at = input?.expiresAt ?? created_at + DEFAULT_TTL_MS
      const cap_usd = input?.capUsd ?? DEFAULT_CAP
      let code = generateInviteCode()
      while (selectInvite.get(code)) code = generateInviteCode()
      insertInvite.run(code, cap_usd, expires_at, input?.note ?? null, created_at)
      return selectInvite.get(code) as InviteRow
    },

    getInvite: lookup,

    inviteCount(): number {
      return (countInvites.get() as { n: number }).n
    },

    revoke(raw: string): boolean {
      const row = lookup(raw)
      if (!row) return false
      revokeInvite.run(row.code)
      return true
    },

    addSpend(input: {
      code: string
      model: string
      rung: Rung
      inputTokens: number
      outputTokens: number
      usd: number
    }): InviteRow {
      const at = Date.now()
      db.transaction(() => {
        insertUsage.run(
          input.code,
          at,
          input.model,
          input.rung,
          input.inputTokens,
          input.outputTokens,
          input.usd,
        )
        addSpent.run(input.usd, input.code)
      })()
      return selectInvite.get(input.code) as InviteRow
    },

    usageFor(raw: string): UsageRow[] {
      const row = lookup(raw)
      if (!row) return []
      return usageByCode.all(row.code) as UsageRow[]
    },

    spendSince(code: string, since: number): number {
      return (hourlySpend.get(code, since) as { total: number }).total
    },

    allInvites(): InviteRow[] {
      return allInvites.all() as InviteRow[]
    },

    invitesForAdmin(): Array<InviteRow & { email: string | null }> {
      const emails = new Map(
        (allAccounts.all() as { invite_code: string; email: string | null }[]).map((row) => [
          row.invite_code,
          row.email,
        ]),
      )
      return (allInvites.all() as InviteRow[]).map((row) => ({
        ...row,
        email: emails.get(row.code) ?? null,
      }))
    },

    getMode(): OperatingMode {
      const row = getSetting.get("mode") as { value: string } | undefined
      if (row?.value === "capped" || row?.value === "cheapest" || row?.value === "normal") return row.value
      return "normal"
    },

    setMode(mode: OperatingMode) {
      setSetting.run("mode", mode)
    },

    getAlertFlag(key: string): boolean {
      return (getSetting.get(key) as { value: string } | undefined)?.value === "1"
    },

    setAlertFlag(key: string) {
      setSetting.run(key, "1")
    },

    recordBurnIn(payload: unknown) {
      insertBurnIn.run(crypto.randomUUID(), Date.now(), JSON.stringify(payload))
    },

    createCliLogin(input: { expiresAt: number }): { device_code: string; user_code: string; expires_at: number } {
      const created_at = Date.now()
      purgeCli.run(created_at)
      const device_code = generateDeviceSecret()
      let user_code = generateDeviceUserCode()
      while (selectCliByUser.get(user_code)) user_code = generateDeviceUserCode()
      insertCliLogin.run(device_code, user_code, input.expiresAt, created_at)
      return { device_code, user_code, expires_at: input.expiresAt }
    },

    approveCliLogin(userCode: string, inviteCode: string, now: number): boolean {
      const user_code = canonicalDeviceUserCode(userCode)
      if (!user_code) return false
      const row = selectCliByUser.get(user_code) as CliLoginRow | undefined
      if (!row || row.expires_at <= now) return false
      if (row.invite_code && row.invite_code !== inviteCode) return false
      approveCli.run(inviteCode, user_code)
      return true
    },

    pollCliLogin(deviceCode: string, now: number): { status: "pending" } | { status: "approved"; code: string } | { status: "expired" } {
      const row = selectCliByDevice.get(deviceCode) as CliLoginRow | undefined
      if (!row || row.expires_at <= now) {
        if (row) deleteCli.run(row.device_code)
        return { status: "expired" }
      }
      if (!row.invite_code) return { status: "pending" }
      deleteCli.run(row.device_code)
      return { status: "approved", code: row.invite_code }
    },

    getAccount(uid: string): AccountRow | undefined {
      return selectAccount.get(uid) as AccountRow | undefined
    },

    bindAccount(input: { uid: string; email?: string; inviteCode: string }): AccountRow | undefined {
      const existing = selectAccount.get(input.uid) as AccountRow | undefined
      if (existing) return existing.invite_code === input.inviteCode ? existing : undefined
      if (selectAccountByInvite.get(input.inviteCode)) return
      insertAccount.run(input.uid, input.inviteCode, input.email ?? null, Date.now())
      return selectAccount.get(input.uid) as AccountRow
    },

    createApiKey(input: { inviteCode: string; name?: string }): { secret: string; key: PublicApiKey } | undefined {
      const invite = lookup(input.inviteCode)
      if (!invite) return
      const active = (countActiveApiKeys.get(invite.code) as { n: number }).n
      if (active >= MAX_API_KEYS) return
      const secret = generateApiKeySecret()
      const created_at = Date.now()
      let id = generateApiKeyId()
      while (selectApiKey.get(id)) id = generateApiKeyId()
      const name = sanitizeKeyName(input.name)
      insertApiKey.run(id, invite.code, hashApiKey(secret), apiKeyPrefix(secret), name, created_at)
      return { secret, key: publicApiKey(selectApiKey.get(id) as ApiKeyRow) }
    },

    listApiKeys(raw: string): PublicApiKey[] {
      const invite = lookup(raw)
      if (!invite) return []
      return (selectApiKeysForInvite.all(invite.code) as ApiKeyRow[]).map(publicApiKey)
    },

    revokeApiKey(input: { inviteCode: string; id: string }): boolean {
      const invite = lookup(input.inviteCode)
      if (!invite) return false
      return markApiKeyRevoked.run(input.id, invite.code).changes > 0
    },

    inviteForApiKey(raw: string, now: number): InviteRow | undefined {
      const secret = canonicalApiKey(raw)
      if (!secret) return
      const key = selectApiKeyByHash.get(hashApiKey(secret)) as ApiKeyRow | undefined
      if (!key || key.revoked) return
      const invite = selectInvite.get(key.invite_code) as InviteRow | undefined
      if (!invite || invite.revoked || invite.expires_at <= now) return
      if (!key.last_used_at || now - key.last_used_at >= TOUCH_API_KEY_MS) {
        touchApiKey.run(now, key.id)
      }
      return invite
    },

    close() {
      db.close()
    },
  }
}

export type GatewayStore = ReturnType<typeof openGatewayStore>

function publicApiKey(row: ApiKeyRow): PublicApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked: Boolean(row.revoked),
  }
}

function sanitizeKeyName(raw?: string) {
  const name = raw?.trim() ?? ""
  if (!name) return "Agent"
  return name.slice(0, 64)
}
