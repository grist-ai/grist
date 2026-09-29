import { Database } from "bun:sqlite"
import type { OperatingMode } from "@grist-ai/logic"
import type { Rung } from "@grist-ai/logic"
import type { ByokProvider } from "./providers.js"
import {
  decryptProviderKey,
  encryptProviderKey,
  fingerprintKey,
} from "./provider-keys.js"
import {
  apiKeyPrefix,
  canonicalApiKey,
  canonicalDeviceUserCode,
  canonicalInviteCode,
  generateApiKeyId,
  generateApiKeySecret,
  generateConnectorSecret,
  generateDeviceSecret,
  generateDeviceUserCode,
  generateInviteCode,
  hashApiKey,
} from "./codes.js"

export type AccountRow = {
  firebase_uid: string
  invite_code: string
  email: string | null
  first_name: string | null
  last_name: string | null
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
  key_id: string | null
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
  kind: ApiKeyKind
  created_at: number
  last_used_at: number | null
  revoked: number
}

export type PublicApiKey = {
  id: string
  name: string
  kind: ApiKeyKind
  prefix: string
  created_at: number
  last_used_at: number | null
  revoked: boolean
}

/** Key kinds. `connector` tokens are scoped for third-party agents (e.g.
 * Meta's Muse): they can route, complete, and read spend, but can never
 * touch provider keys. */
export type ApiKeyKind = "standard" | "connector"

export type ProviderCredentialRow = {
  code: string
  provider: string
  key_blob: string
  key_fingerprint: string
  base_url: string | null
  custom_models: string | null
  created_at: number
  updated_at: number
}

/** Decrypted provider credential — only ever held in memory, never logged. */
export type ProviderCredential = {
  code: string
  provider: ByokProvider
  apiKey: string
  baseURL: string | null
  customModels: Partial<Record<Rung, string>>
  keyFingerprint: string
}

/** Safe-to-display credential summary: identifies the key, never reveals it. */
export type ProviderCredentialSummary = {
  provider: ByokProvider
  keyFingerprint: string
  baseURL: string | null
  hasCustomModels: boolean
  updatedAt: number
}

const DEFAULT_CAP = 5
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Auto-minted account codes don't expire on a human timescale. */
export const ACCOUNT_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000
const MAX_API_KEYS = 20
const TOUCH_API_KEY_MS = 60_000

export function openGatewayStore(filePath = ":memory:", opts?: { masterKey?: Buffer }) {
  const db = new Database(filePath)
  const masterKey = opts?.masterKey
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
      key_id TEXT,
      at INTEGER NOT NULL,
      model TEXT NOT NULL,
      rung TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      usd REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS usage_events_code_at ON usage_events(code, at);
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
      first_name TEXT,
      last_name TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      invite_code TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'standard',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS api_keys_invite ON api_keys(invite_code);
    CREATE TABLE IF NOT EXISTS provider_credentials (
      code TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      key_blob TEXT NOT NULL,
      key_fingerprint TEXT NOT NULL,
      base_url TEXT,
      custom_models TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rung_model_overrides (
      code TEXT NOT NULL,
      rung TEXT NOT NULL,
      model_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (code, rung)
    );
  `)
  // `CREATE TABLE IF NOT EXISTS` will not add the column to a database created
  // before per-key attribution existed, so backfill it in place.
  const usageColumns = db.prepare("PRAGMA table_info(usage_events)").all() as { name: string }[]
  if (!usageColumns.some((column) => column.name === "key_id")) {
    db.exec("ALTER TABLE usage_events ADD COLUMN key_id TEXT")
  }
  // Same for the account name columns added with the sign-up UX.
  const accountColumns = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]
  if (!accountColumns.some((column) => column.name === "first_name")) {
    db.exec("ALTER TABLE accounts ADD COLUMN first_name TEXT")
  }
  if (!accountColumns.some((column) => column.name === "last_name")) {
    db.exec("ALTER TABLE accounts ADD COLUMN last_name TEXT")
  }
  // And the key kind column added for scoped connector tokens. Existing keys
  // default to the full `standard` kind.
  const apiKeyColumns = db.prepare("PRAGMA table_info(api_keys)").all() as { name: string }[]
  if (!apiKeyColumns.some((column) => column.name === "kind")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard'")
  }

  const insertInvite = db.prepare(
    `INSERT INTO invites (code, cap_usd, spent_usd, expires_at, revoked, note, created_at)
     VALUES (?, ?, 0, ?, 0, ?, ?)`,
  )
  const selectInvite = db.prepare(`SELECT * FROM invites WHERE code = ?`)
  const revokeInvite = db.prepare(`UPDATE invites SET revoked = 1 WHERE code = ?`)
  const addSpent = db.prepare(`UPDATE invites SET spent_usd = spent_usd + ? WHERE code = ?`)
  const resetSpent = db.prepare(`UPDATE invites SET spent_usd = 0 WHERE code = ?`)
  const setCapUsd = db.prepare(`UPDATE invites SET cap_usd = ? WHERE code = ?`)
  const insertUsage = db.prepare(
    `INSERT INTO usage_events (code, key_id, at, model, rung, input_tokens, output_tokens, usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
  // B6: atomic bind backstop. BEGIN IMMEDIATE serializes binders across
  // processes; ON CONFLICT DO NOTHING turns a lost race into changes === 0
  // (clean 409) instead of an unhandled 500.
  const insertAccountIgnore = db.prepare(
    `INSERT INTO accounts (firebase_uid, invite_code, email, first_name, last_name, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  )
  const updateAccountNames = db.prepare(
    `UPDATE accounts SET first_name = ?, last_name = ? WHERE firebase_uid = ?`,
  )
  const selectAccount = db.prepare(`SELECT * FROM accounts WHERE firebase_uid = ?`)
  const selectAccountByInvite = db.prepare(`SELECT * FROM accounts WHERE invite_code = ?`)
  const allAccounts = db.prepare(`SELECT invite_code, email FROM accounts`)
  const insertApiKey = db.prepare(
    `INSERT INTO api_keys (id, invite_code, hash, prefix, name, kind, created_at, last_used_at, revoked)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
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
  const upsertCredential = db.prepare(
    `INSERT INTO provider_credentials (code, provider, key_blob, key_fingerprint, base_url, custom_models, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       provider = excluded.provider,
       key_blob = excluded.key_blob,
       key_fingerprint = excluded.key_fingerprint,
       base_url = excluded.base_url,
       custom_models = excluded.custom_models,
       updated_at = excluded.updated_at`,
  )
  const selectCredential = db.prepare(`SELECT * FROM provider_credentials WHERE code = ?`)
  const deleteCredential = db.prepare(`DELETE FROM provider_credentials WHERE code = ?`)
  const upsertRungOverride = db.prepare(
    `INSERT INTO rung_model_overrides (code, rung, model_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(code, rung) DO UPDATE SET model_id = excluded.model_id, updated_at = excluded.updated_at`,
  )
  const selectRungOverrides = db.prepare(`SELECT rung, model_id FROM rung_model_overrides WHERE code = ?`)
  const deleteRungOverride = db.prepare(`DELETE FROM rung_model_overrides WHERE code = ? AND rung = ?`)
  const deleteRungOverrides = db.prepare(`DELETE FROM rung_model_overrides WHERE code = ?`)

  function requireMasterKey(): Buffer {
    if (!masterKey) throw new Error("GRIST_MASTER_KEY is not configured")
    return masterKey
  }

  function lookup(raw: string): InviteRow | undefined {
    const code = canonicalInviteCode(raw)
    if (!code) return
    return selectInvite.get(code) as InviteRow | undefined
  }

  /** Resolve an API key to its invite code without touching last_used_at. */
  function apiKeyToInviteCode(raw: string): string | undefined {
    const secret = canonicalApiKey(raw)
    if (!secret) return
    const key = selectApiKeyByHash.get(hashApiKey(secret)) as ApiKeyRow | undefined
    if (!key || key.revoked) return
    return key.invite_code
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
      keyId?: string | null
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
          input.keyId ?? null,
          at,
          input.model,
          input.rung,
          input.inputTokens,
          input.outputTokens,
          input.usd,
        )
        // The running total always tracks the metered spend exactly, so
        // spent_usd, the usage-events audit log, and remaining_usd can never
        // diverge. Cap enforcement happens before the upstream call
        // (capResponse 402s once spent_usd >= cap_usd); the debit here is
        // pure bookkeeping. Clamping or skipping the debit made the account
        // look cheaper than it was and broke remaining_usd after a cap raise.
        addSpent.run(input.usd, input.code)
      })()
      return selectInvite.get(input.code) as InviteRow
    },

    /**
     * Self-serve spend-cap change. The cap is the account holder's own
     * budgeting tool under BYOK (inference bills to their provider key), so
     * it is theirs to raise — no upper bound. Lowering below already-spent
     * is rejected by the caller; the store just writes.
     */
    setCap(code: string, capUsd: number): InviteRow | undefined {
      setCapUsd.run(capUsd, code)
      return selectInvite.get(code) as InviteRow | undefined
    },

    /**
     * One-time spend reset for an invite, addressed by invite code or API key.
     * Usage history is kept for audit; only the running total is zeroed.
     */
    resetSpend(raw: string): { code: string; previousUsd: number } | undefined {
      const code = lookup(raw)?.code ?? apiKeyToInviteCode(raw)
      if (!code) return
      const before = (selectInvite.get(code) as InviteRow).spent_usd
      resetSpent.run(code)
      return { code, previousUsd: before }
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

    bindAccount(input: {
      uid: string
      email?: string
      firstName?: string
      lastName?: string
      inviteCode: string
    }):
      | { ok: true; account: AccountRow }
      | { ok: false; reason: "code_taken" | "already_bound" } {
      // Single-use onboarding: one code -> one account, one account -> one
      // code, no unbind/rebind. BEGIN IMMEDIATE makes check-then-insert atomic
      // across processes sharing the DB file (overlapping deploys).
      db.exec("BEGIN IMMEDIATE")
      try {
        const existing = selectAccount.get(input.uid) as AccountRow | undefined
        if (existing) {
          // Fill in names supplied later (e.g. sign-up completed after a
          // Google sign-in that carried no display name).
          const firstName = input.firstName?.trim() || existing.first_name
          const lastName = input.lastName?.trim() || existing.last_name
          if (firstName !== existing.first_name || lastName !== existing.last_name) {
            updateAccountNames.run(firstName ?? null, lastName ?? null, input.uid)
          }
          const account = selectAccount.get(input.uid) as AccountRow
          const result =
            existing.invite_code === input.inviteCode
              ? { ok: true as const, account }
              : { ok: false as const, reason: "already_bound" as const }
          db.exec("COMMIT")
          return result
        }
        const bound = selectAccountByInvite.get(input.inviteCode) as AccountRow | undefined
        if (bound) {
          db.exec("COMMIT")
          return { ok: false, reason: "code_taken" }
        }
        const applied = insertAccountIgnore.run(
          input.uid,
          input.inviteCode,
          input.email ?? null,
          input.firstName?.trim() || null,
          input.lastName?.trim() || null,
          Date.now(),
        )
        if (applied.changes === 0) {
          // Lost a race that slipped past the reads: classify the winner.
          const winner = selectAccountByInvite.get(input.inviteCode) as AccountRow | undefined
          db.exec("COMMIT")
          if (winner && winner.firebase_uid !== input.uid) return { ok: false, reason: "code_taken" }
          const mine = selectAccount.get(input.uid) as AccountRow | undefined
          return mine ? { ok: true, account: mine } : { ok: false, reason: "already_bound" }
        }
        const account = selectAccount.get(input.uid) as AccountRow
        db.exec("COMMIT")
        return { ok: true, account }
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },

    createApiKey(input: { inviteCode: string; name?: string; kind?: ApiKeyKind }): { secret: string; key: PublicApiKey } | undefined {
      const invite = lookup(input.inviteCode)
      if (!invite) return
      const active = (countActiveApiKeys.get(invite.code) as { n: number }).n
      if (active >= MAX_API_KEYS) return
      const kind: ApiKeyKind = input.kind ?? "standard"
      const secret = kind === "connector" ? generateConnectorSecret() : generateApiKeySecret()
      const created_at = Date.now()
      let id = generateApiKeyId()
      while (selectApiKey.get(id)) id = generateApiKeyId()
      const name = sanitizeKeyName(input.name)
      insertApiKey.run(id, invite.code, hashApiKey(secret), apiKeyPrefix(secret), name, kind, created_at)
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

    /**
     * Store (or replace) the user's BYOK provider key, encrypted at rest.
     * Throws when GRIST_MASTER_KEY is not configured. The raw key never
     * touches the database — only the encrypted blob and its fingerprint.
     */
    setProviderCredential(input: {
      inviteCode: string
      provider: ByokProvider
      apiKey: string
      baseURL?: string
      customModels?: Partial<Record<Rung, string>>
    }): ProviderCredentialSummary {
      const invite = lookup(input.inviteCode)
      if (!invite) throw new Error("unknown invite code")
      const apiKey = input.apiKey.trim()
      if (!apiKey) throw new Error("provider key must not be empty")
      const key = requireMasterKey()
      const now = Date.now()
      const existing = selectCredential.get(invite.code) as ProviderCredentialRow | undefined
      const baseURL = input.baseURL?.trim().replace(/\/+$/, "") || null
      const customModels = input.customModels ? JSON.stringify(input.customModels) : null
      upsertCredential.run(
        invite.code,
        input.provider,
        encryptProviderKey(apiKey, key),
        fingerprintKey(apiKey),
        baseURL,
        customModels,
        existing?.created_at ?? now,
        now,
      )
      return toCredentialSummary(selectCredential.get(invite.code) as ProviderCredentialRow)
    },

    /**
     * Decrypted credential for building an upstream request. Returns undefined
     * when the user never set a provider key. Throws when a credential exists
     * but GRIST_MASTER_KEY is not configured (fail closed).
     */
    getProviderCredential(inviteCode: string): ProviderCredential | undefined {
      const invite = lookup(inviteCode)
      if (!invite) return undefined
      const row = selectCredential.get(invite.code) as ProviderCredentialRow | undefined
      if (!row) return undefined
      const key = requireMasterKey()
      return {
        code: row.code,
        provider: row.provider as ByokProvider,
        apiKey: decryptProviderKey(row.key_blob, key),
        baseURL: row.base_url,
        customModels: row.custom_models ? (JSON.parse(row.custom_models) as Partial<Record<Rung, string>>) : {},
        keyFingerprint: row.key_fingerprint,
      }
    },

    /** Safe-to-display summary: identifies the key, never reveals it. */
    providerCredentialSummary(inviteCode: string): ProviderCredentialSummary | undefined {
      const invite = lookup(inviteCode)
      if (!invite) return undefined
      const row = selectCredential.get(invite.code) as ProviderCredentialRow | undefined
      if (!row) return undefined
      return toCredentialSummary(row)
    },

    deleteProviderCredential(inviteCode: string): boolean {
      const invite = lookup(inviteCode)
      if (!invite) return false
      return deleteCredential.run(invite.code).changes > 0
    },

    /**
     * Per-account rung → model id overrides. An override wins over the
     * server default ladder; deleting it restores the default.
     */
    getRungModelOverrides(inviteCode: string): Partial<Record<Rung, string>> {
      const invite = lookup(inviteCode)
      if (!invite) return {}
      const rows = selectRungOverrides.all(invite.code) as { rung: string; model_id: string }[]
      return Object.fromEntries(rows.map((row) => [row.rung, row.model_id]))
    },

    setRungModelOverride(inviteCode: string, rung: Rung, modelId: string): boolean {
      const invite = lookup(inviteCode)
      if (!invite) return false
      upsertRungOverride.run(invite.code, rung, modelId, Date.now())
      return true
    },

    deleteRungModelOverride(inviteCode: string, rung: Rung): boolean {
      const invite = lookup(inviteCode)
      if (!invite) return false
      return deleteRungOverride.run(invite.code, rung).changes > 0
    },

    clearRungModelOverrides(inviteCode: string): boolean {
      const invite = lookup(inviteCode)
      if (!invite) return false
      deleteRungOverrides.run(invite.code)
      return true
    },

    inviteForApiKey(raw: string, now: number): (InviteRow & { keyId: string; keyKind: ApiKeyKind }) | undefined {
      const secret = canonicalApiKey(raw)
      if (!secret) return
      const key = selectApiKeyByHash.get(hashApiKey(secret)) as ApiKeyRow | undefined
      if (!key || key.revoked) return
      const invite = selectInvite.get(key.invite_code) as InviteRow | undefined
      if (!invite || invite.revoked || invite.expires_at <= now) return
      if (!key.last_used_at || now - key.last_used_at >= TOUCH_API_KEY_MS) {
        touchApiKey.run(now, key.id)
      }
      return { ...invite, keyId: key.id, keyKind: key.kind }
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
    kind: row.kind,
    prefix: row.prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked: Boolean(row.revoked),
  }
}

function toCredentialSummary(row: ProviderCredentialRow): ProviderCredentialSummary {
  return {
    provider: row.provider as ByokProvider,
    keyFingerprint: row.key_fingerprint,
    baseURL: row.base_url,
    hasCustomModels: Boolean(row.custom_models),
    updatedAt: row.updated_at,
  }
}

function sanitizeKeyName(raw?: string) {
  const name = raw?.trim() ?? ""
  if (!name) return "Agent"
  return name.slice(0, 64)
}
