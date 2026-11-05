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
  canonicalUserId,
  generateApiKeyId,
  generateApiKeySecret,
  generateConnectorSecret,
  generateDeviceSecret,
  generateDeviceUserCode,
  generateInviteCode,
  generateNotificationId,
  generateTeamId,
  generateUserId,
  hashApiKey,
} from "./codes.js"

export type AccountRow = {
  firebase_uid: string
  invite_code: string
  email: string | null
  first_name: string | null
  last_name: string | null
  user_id: string | null
  created_at: number
}

export type TeamRole = "owner" | "admin" | "member"

export type TeamRow = {
  id: string
  name: string
  owner_uid: string
  created_at: number
}

export type TeamMemberRow = {
  team_id: string
  firebase_uid: string
  role: TeamRole
  added_by: string | null
  created_at: number
}

export type TeamMemberView = TeamMemberRow & {
  email: string | null
  first_name: string | null
  last_name: string | null
  user_id: string | null
}

export type TeamUsageRow = {
  firebase_uid: string
  user_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  role: TeamRole
  spent_usd: number
}

export type TeamKeyContext = {
  owner_invite_code: string
  team_name: string
  owner_email: string | null
  is_owner: number
}

export type NotificationRow = {
  id: string
  firebase_uid: string
  type: string
  payload: string
  read_at: number | null
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
      user_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_uid TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      added_by TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, firebase_uid)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS team_members_uid ON team_members(firebase_uid);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      read_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_uid_at ON notifications(firebase_uid, created_at);
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
  // Public user IDs: the shareable handle teams add members by. Backfilled
  // for every account created before they existed, so an ID always resolves.
  if (!accountColumns.some((column) => column.name === "user_id")) {
    db.exec("ALTER TABLE accounts ADD COLUMN user_id TEXT")
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_id ON accounts(user_id)")
  const selectUserIdTaken = db.prepare(`SELECT 1 FROM accounts WHERE user_id = ?`)
  const setAccountUserId = db.prepare(`UPDATE accounts SET user_id = ? WHERE firebase_uid = ?`)
  const accountsMissingUserId = db
    .prepare(`SELECT firebase_uid FROM accounts WHERE user_id IS NULL`)
    .all() as { firebase_uid: string }[]
  for (const row of accountsMissingUserId) {
    let userId = generateUserId()
    while (selectUserIdTaken.get(userId)) userId = generateUserId()
    setAccountUserId.run(userId, row.firebase_uid)
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
  const renewInviteExpiry = db.prepare(`UPDATE invites SET expires_at = ? WHERE code = ? AND revoked = 0`)
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
    `INSERT INTO accounts (firebase_uid, invite_code, email, first_name, last_name, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  )
  const updateAccountNames = db.prepare(
    `UPDATE accounts SET first_name = ?, last_name = ? WHERE firebase_uid = ?`,
  )
  const selectAccount = db.prepare(`SELECT * FROM accounts WHERE firebase_uid = ?`)
  const selectAccountByInvite = db.prepare(`SELECT * FROM accounts WHERE invite_code = ?`)
  const selectAccountByUserId = db.prepare(`SELECT * FROM accounts WHERE user_id = ?`)
  const insertTeam = db.prepare(
    `INSERT INTO teams (id, name, owner_uid, created_at) VALUES (?, ?, ?, ?)`,
  )
  const selectTeam = db.prepare(`SELECT * FROM teams WHERE id = ?`)
  const deleteTeamRow = db.prepare(`DELETE FROM teams WHERE id = ?`)
  const updateTeamOwner = db.prepare(`UPDATE teams SET owner_uid = ? WHERE id = ?`)
  const insertTeamMember = db.prepare(
    `INSERT INTO team_members (team_id, firebase_uid, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
  const selectMembership = db.prepare(`SELECT * FROM team_members WHERE firebase_uid = ?`)
  const selectTeamMembers = db.prepare(
    `SELECT m.*, a.email, a.first_name, a.last_name, a.user_id
     FROM team_members m JOIN accounts a ON a.firebase_uid = m.firebase_uid
     WHERE m.team_id = ? ORDER BY m.created_at ASC`,
  )
  const deleteTeamMember = db.prepare(
    `DELETE FROM team_members WHERE team_id = ? AND firebase_uid = ?`,
  )
  const deleteAllTeamMembers = db.prepare(`DELETE FROM team_members WHERE team_id = ?`)
  const updateMemberRole = db.prepare(
    `UPDATE team_members SET role = ? WHERE team_id = ? AND firebase_uid = ?`,
  )
  const insertNotification = db.prepare(
    `INSERT INTO notifications (id, firebase_uid, type, payload, read_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  )
  const selectNotifications = db.prepare(
    `SELECT * FROM notifications WHERE firebase_uid = ? ORDER BY created_at DESC LIMIT ?`,
  )
  const markNotificationReadRow = db.prepare(
    `UPDATE notifications SET read_at = ? WHERE id = ? AND firebase_uid = ? AND read_at IS NULL`,
  )
  const selectNotification = db.prepare(`SELECT * FROM notifications WHERE id = ?`)
  const selectTeamKeyContext = db.prepare(
    `SELECT o.invite_code AS owner_invite_code, t.name AS team_name, o.email AS owner_email,
            (t.owner_uid = a.firebase_uid) AS is_owner
     FROM accounts a
     JOIN team_members m ON m.firebase_uid = a.firebase_uid
     JOIN teams t ON t.id = m.team_id
     JOIN accounts o ON o.firebase_uid = t.owner_uid
     WHERE a.invite_code = ?`,
  )
  const selectTeamUsage = db.prepare(
    `SELECT a.firebase_uid, a.user_id, a.email, a.first_name, a.last_name, m.role, i.spent_usd
     FROM team_members m
     JOIN accounts a ON a.firebase_uid = m.firebase_uid
     JOIN invites i ON i.code = a.invite_code
     WHERE m.team_id = ? ORDER BY m.created_at ASC`,
  )
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

  function accountByUserId(raw: string): AccountRow | undefined {
    const userId = canonicalUserId(raw)
    if (!userId) return
    // bun:sqlite returns null for no row; normalize to undefined.
    return (selectAccountByUserId.get(userId) as AccountRow | null) ?? undefined
  }

  function notify(uid: string, type: string, payload: Record<string, unknown>): NotificationRow {
    let id = generateNotificationId()
    while (selectNotification.get(id)) id = generateNotificationId()
    insertNotification.run(id, uid, type, JSON.stringify(payload), Date.now())
    return selectNotification.get(id) as NotificationRow
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
     * Extends a lapsed invite's expiry in place. Cap, spend history and API
     * keys all hang off the code, so renewing the row keeps the account
     * whole. A revoked invite is a deliberate operator act: the statement's
     * revoked = 0 guard leaves it untouched and the stale row is returned.
     */
    renewInvite(code: string, expiresAt: number): InviteRow | undefined {
      renewInviteExpiry.run(expiresAt, code)
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
        let userId = generateUserId()
        while (selectAccountByUserId.get(userId)) userId = generateUserId()
        const applied = insertAccountIgnore.run(
          input.uid,
          input.inviteCode,
          input.email ?? null,
          input.firstName?.trim() || null,
          input.lastName?.trim() || null,
          userId,
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

    getAccountByUserId(raw: string): AccountRow | undefined {
      return accountByUserId(raw)
    },

    createNotification(input: {
      uid: string
      type: string
      payload: Record<string, unknown>
    }): NotificationRow {
      return notify(input.uid, input.type, input.payload)
    },

    listNotifications(uid: string, limit = 50): NotificationRow[] {
      return selectNotifications.all(uid, limit) as NotificationRow[]
    },

    markNotificationRead(uid: string, id: string): boolean {
      return markNotificationReadRow.run(Date.now(), id, uid).changes > 0
    },

    /**
     * Anyone can create a team — unless they already belong to one. The
     * one-team rule is structural: team_members carries a UNIQUE index on
     * firebase_uid, so a second membership cannot exist even if a caller
     * skips these checks.
     */
    createTeam(input: { ownerUid: string; name: string }):
      | { ok: true; team: TeamRow }
      | { ok: false; reason: "invalid_name" | "already_in_team" } {
      const name = input.name.trim().slice(0, 80)
      if (!name) return { ok: false, reason: "invalid_name" }
      if (selectMembership.get(input.ownerUid)) return { ok: false, reason: "already_in_team" }
      let id = generateTeamId()
      while (selectTeam.get(id)) id = generateTeamId()
      const at = Date.now()
      db.transaction(() => {
        insertTeam.run(id, name, input.ownerUid, at)
        insertTeamMember.run(id, input.ownerUid, "owner", input.ownerUid, at)
      })()
      return { ok: true, team: selectTeam.get(id) as TeamRow }
    },

    getTeamForUser(uid: string): { team: TeamRow; membership: TeamMemberRow } | undefined {
      const membership = selectMembership.get(uid) as TeamMemberRow | undefined
      if (!membership) return
      const team = selectTeam.get(membership.team_id) as TeamRow | undefined
      if (!team) return
      return { team, membership }
    },

    listTeamMembers(teamId: string): TeamMemberView[] {
      return selectTeamMembers.all(teamId) as TeamMemberView[]
    },

    /**
     * Add a user to a team by their public user ID (owner/admin only). A
     * user who belongs to another team is never moved silently: the add is
     * refused and THEY are notified which team tried to add them and which
     * team they must leave first. A teamless user is added directly and
     * notified that it happened.
     */
    addTeamMember(input: { teamId: string; actorUid: string; targetUserId: string }):
      | { ok: true; member: TeamMemberRow }
      | {
          ok: false
          reason: "team_not_found" | "not_authorized" | "user_not_found" | "already_member" | "in_other_team"
          otherTeam?: TeamRow
        } {
      const team = selectTeam.get(input.teamId) as TeamRow | undefined
      if (!team) return { ok: false, reason: "team_not_found" }
      const actor = selectMembership.get(input.actorUid) as TeamMemberRow | undefined
      if (!actor || actor.team_id !== input.teamId || (actor.role !== "owner" && actor.role !== "admin")) {
        return { ok: false, reason: "not_authorized" }
      }
      const target = accountByUserId(input.targetUserId)
      if (!target) return { ok: false, reason: "user_not_found" }
      const existing = selectMembership.get(target.firebase_uid) as TeamMemberRow | undefined
      if (existing && existing.team_id === input.teamId) return { ok: false, reason: "already_member" }
      if (existing) {
        const otherTeam = selectTeam.get(existing.team_id) as TeamRow | undefined
        notify(target.firebase_uid, "team_add_blocked", {
          teamId: team.id,
          teamName: team.name,
          currentTeamId: existing.team_id,
          currentTeamName: otherTeam?.name ?? null,
        })
        return { ok: false, reason: "in_other_team", otherTeam }
      }
      insertTeamMember.run(input.teamId, target.firebase_uid, "member", input.actorUid, Date.now())
      notify(target.firebase_uid, "team_added", { teamId: team.id, teamName: team.name })
      return { ok: true, member: selectMembership.get(target.firebase_uid) as TeamMemberRow }
    },

    removeTeamMember(input: { teamId: string; actorUid: string; targetUid: string }):
      | { ok: true }
      | { ok: false; reason: "team_not_found" | "not_authorized" | "not_member" | "cannot_remove_owner" } {
      const team = selectTeam.get(input.teamId) as TeamRow | undefined
      if (!team) return { ok: false, reason: "team_not_found" }
      const target = selectMembership.get(input.targetUid) as TeamMemberRow | undefined
      if (!target || target.team_id !== input.teamId) return { ok: false, reason: "not_member" }
      if (target.role === "owner") return { ok: false, reason: "cannot_remove_owner" }
      const actor = selectMembership.get(input.actorUid) as TeamMemberRow | undefined
      if (!actor || actor.team_id !== input.teamId || (actor.role !== "owner" && actor.role !== "admin")) {
        return { ok: false, reason: "not_authorized" }
      }
      deleteTeamMember.run(input.teamId, input.targetUid)
      notify(input.targetUid, "team_removed", { teamId: team.id, teamName: team.name })
      return { ok: true }
    },

    setTeamMemberRole(input: { teamId: string; actorUid: string; targetUid: string; role: "admin" | "member" }):
      | { ok: true }
      | { ok: false; reason: "team_not_found" | "not_authorized" | "not_member" | "cannot_change_owner" } {
      const team = selectTeam.get(input.teamId) as TeamRow | undefined
      if (!team) return { ok: false, reason: "team_not_found" }
      if (team.owner_uid !== input.actorUid) return { ok: false, reason: "not_authorized" }
      const target = selectMembership.get(input.targetUid) as TeamMemberRow | undefined
      if (!target || target.team_id !== input.teamId) return { ok: false, reason: "not_member" }
      if (target.role === "owner") return { ok: false, reason: "cannot_change_owner" }
      updateMemberRole.run(input.role, input.teamId, input.targetUid)
      return { ok: true }
    },

    /**
     * Leave the caller's current team. An owner with members left must
     * transfer ownership first; a sole owner leaving dissolves the team.
     */
    leaveTeam(input: { uid: string }):
      | { ok: true; dissolved: boolean }
      | { ok: false; reason: "not_in_team" | "owner_must_transfer" } {
      const membership = selectMembership.get(input.uid) as TeamMemberRow | undefined
      if (!membership) return { ok: false, reason: "not_in_team" }
      const team = selectTeam.get(membership.team_id) as TeamRow | undefined
      if (membership.role !== "owner") {
        deleteTeamMember.run(membership.team_id, input.uid)
        if (team) {
          const leaver = selectAccount.get(input.uid) as AccountRow | undefined
          notify(team.owner_uid, "team_member_left", {
            teamId: team.id,
            teamName: team.name,
            userId: leaver?.user_id ?? null,
            email: leaver?.email ?? null,
          })
        }
        return { ok: true, dissolved: false }
      }
      const others = (selectTeamMembers.all(membership.team_id) as TeamMemberView[]).filter(
        (member) => member.firebase_uid !== input.uid,
      )
      if (others.length > 0) return { ok: false, reason: "owner_must_transfer" }
      db.transaction(() => {
        deleteAllTeamMembers.run(membership.team_id)
        deleteTeamRow.run(membership.team_id)
      })()
      return { ok: true, dissolved: true }
    },

    transferTeamOwnership(input: { teamId: string; actorUid: string; targetUid: string }):
      | { ok: true }
      | { ok: false; reason: "team_not_found" | "not_authorized" | "not_member" } {
      const team = selectTeam.get(input.teamId) as TeamRow | undefined
      if (!team) return { ok: false, reason: "team_not_found" }
      if (team.owner_uid !== input.actorUid) return { ok: false, reason: "not_authorized" }
      const target = selectMembership.get(input.targetUid) as TeamMemberRow | undefined
      if (!target || target.team_id !== input.teamId) return { ok: false, reason: "not_member" }
      db.transaction(() => {
        // The outgoing owner steps back to admin — still able to manage
        // the team, no longer its owner.
        updateMemberRole.run("admin", input.teamId, input.actorUid)
        updateMemberRole.run("owner", input.teamId, input.targetUid)
        updateTeamOwner.run(input.targetUid, input.teamId)
      })()
      notify(input.targetUid, "team_ownership", { teamId: team.id, teamName: team.name })
      return { ok: true }
    },

    /**
     * Team key-sharing context for an account: its team's owner invite
     * code and identity. Undefined when the account is in no team.
     */
    teamKeyContext(inviteCode: string): TeamKeyContext | undefined {
      return (selectTeamKeyContext.get(inviteCode) as TeamKeyContext | null) ?? undefined
    },

    /** Per-member spend for a team, from each member account's own invite. */
    teamUsage(teamId: string): TeamUsageRow[] {
      return selectTeamUsage.all(teamId) as TeamUsageRow[]
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
