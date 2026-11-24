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
  generateRunRequestId,
  generateTeamId,
  generateUserId,
  hashApiKey,
} from "./codes.js"
import { parseListenerDefinition, parseListenerEnvelope } from "./listeners.js"

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

export type TeamMemoryStatus = "active" | "flagged" | "archived"

/** One row of the team memory store (spec v2 §5). `code_refs` and
 * `metadata` are JSON text: a string array and an object respectively. */
export type TeamMemoryRow = {
  id: string
  team_id: string
  container: string
  author_uid: string
  author_user_id: string | null
  outcome: string
  content: string
  signature: string
  weight: number
  commit_sha: string | null
  code_refs: string
  metadata: string
  created_at: number
  updated_at: number
  seq: number
  status: TeamMemoryStatus
  superseded_by: string | null
}

/** A validated push entry, normalized by the HTTP layer from a MemoryRecord. */
export type TeamMemoryPushInput = {
  id: string
  container: string
  outcome: string
  content: string
  signature: string
  weight: number
  createdAt: number
  commitSha: string | null
  codeRefs: string[]
  metadata: Record<string, string>
}

export type TeamMemoryPushResult =
  | { status: "stored"; entry: TeamMemoryRow; replayed: boolean }
  | { status: "strengthened"; entry: TeamMemoryRow }
  | { status: "rejected"; reason: "archived" }

export type TeamMemoryAuditRow = {
  id: number
  team_id: string
  /** Content kind the action belongs to: `memory` for team memory rows,
   * the object kind (`skill`, `agent_definition`) for filesystem objects —
   * one trail for the whole team filesystem (filesystem spec v1 §4).
   * Listener lifecycle rows ride the same trail with kind `listener`
   * (next-block spec §6.3). */
  kind: string
  actor_uid: string
  action: string
  entry_id: string
  /** Free-form detail for actions that carry one: the reason on a
   * listener `dropped` row, the spend on a `completed` row. Null for the
   * plain verbs (store/edit/remove) that predate the column. */
  detail: string | null
  at: number
}

/** Action counts from one policy sweep over one team (spec v2 §10). */
export type TeamMemoryPolicyCounts = {
  merged: number
  flagged: number
  decayed: number
  archived: number
}

/** The last policy ("Dreaming") run for a team, as the dashboard shows it
 * (spec v2 §11): when it ran and what it did. */
export type TeamMemoryDreamingRun = TeamMemoryPolicyCounts & { at: number }

/** Team-wide memory counts for the dashboard browser (spec v2 §11). */
export type TeamMemoryCounts = {
  total: number
  byOutcome: Record<string, number>
  byStatus: Record<string, number>
}

/** Team-wide object counts for the dashboard browser (filesystem spec
 * v1 §9): totals across all statuses, split by kind. */
export type TeamObjectCounts = {
  total: number
  byKind: Record<string, number>
  byStatus: Record<string, number>
}

/**
 * Action counts from one object policy sweep over one team (filesystem
 * spec v1 §7). The sweep partitions by kind: objects get the
 * filesystem-wide rules (archive-superseded, chain integrity) and none
 * of memory's evidence rules (merge, decay, staleness) — those key on
 * weight and normalized content, which documents do not have.
 */
export type TeamObjectPolicyCounts = {
  archived: number
  flagged: number
  byKind: Record<string, { archived: number; flagged: number }>
}

/** The last object policy run for a team, as the dashboard shows it. */
export type TeamObjectDreamingRun = TeamObjectPolicyCounts & { at: number }

/** Object kinds in the team filesystem v1 (filesystem spec v1 §3),
 * plus `listener` (next-block spec §6.4 — a definition kind like the
 * others: versioned, admitted, audited; the gateway's webhook intake
 * evaluates the chain heads). Memory never lands in `team_objects`. */
export type TeamObjectKind = "skill" | "agent_definition" | "artifact" | "listener"

export type TeamObjectStatus = "active" | "flagged" | "archived"

/**
 * One row of the team object store (filesystem spec v1 §4). `metadata` is
 * JSON text holding an object of any JSON shape — def config (tool
 * surface, rung ceiling), skill frontmatter overflow — because objects
 * carry their own body/metadata contract; memory's string-only metadata
 * does not bind them. Versioning is a linear supersede chain (§5): an
 * edit is a new row whose `supersedes` names the previous head, and the
 * current version of a (container, kind, name) is the chain tip — the row
 * no other row supersedes. `seq` is a per-team cursor within this table
 * only; it cannot be shared with the memory table's feed (§6).
 */
export type TeamObjectRow = {
  id: string
  team_id: string
  kind: string
  container: string
  name: string
  body: string
  metadata: string
  author_uid: string
  author_user_id: string | null
  supersedes: string | null
  created_at: number
  updated_at: number
  seq: number
  status: TeamObjectStatus
}

/** A validated object push, normalized by the HTTP layer (admission —
 * schema validity + secrets scan — lives there, as with memory). */
export type TeamObjectPushInput = {
  id: string
  kind: TeamObjectKind
  container: string
  name: string
  body: string
  metadata: Record<string, unknown>
  supersedes: string | null
}

export type TeamObjectPushResult =
  | { status: "stored"; object: TeamObjectRow; replayed: boolean }
  | {
      status: "rejected"
      reason: "archived" | "id_conflict" | "name_taken" | "stale_head" | "supersedes_not_found"
    }

/** A list-surface object row: the row plus whether it is its chain's tip. */
export type TeamObjectListRow = TeamObjectRow & { is_head: number }

/**
 * The team-admin ceiling on listener envelopes (next-block spec §6.4,
 * D16): the maximums any single listener on the team may claim. Same
 * numeric shape as a listener envelope; stored as a settings row.
 */
export type ListenerCeiling = {
  max_runs_per_day: number
  max_spend_per_day_usd: number
  max_spend_per_run_usd: number
}

/** A team's webhook intake configuration: the per-team secret webhook
 * senders sign with (next-block spec §6.1). Stored as a settings row;
 * the secret is shown to team owners/admins only, who must configure it
 * on the sender's side (GitHub repo webhook settings) for HMAC to work. */
export type TeamWebhookConfig = {
  secret: string
  created_at: number
}

/**
 * Run-request lifecycle (next-block spec §6.3): `queued` is the only
 * state intake produces; `claimed`/`completed` arrive with the runner
 * (S-LIS2), `refused` with mechanical envelope refusal, `expired` from
 * the queue TTL sweep, and `awaiting_approval` is the committed D6
 * sibling state (S-INBOX1) — the model accommodates it from the start
 * so no later slice rewrites the table.
 */
export type ListenerRunState =
  | "queued"
  | "claimed"
  | "awaiting_approval"
  | "refused"
  | "expired"
  | "completed"

/**
 * One queued run request (next-block spec §6.2): everything a runner
 * claim needs — the listener version that fired, the event facts (not
 * the payload; its digest stands as evidence), the target and envelope
 * snapshots from the definition at fire time, and the creator the run
 * executes as (D14). `event_summary`, `target` and `envelope` are JSON
 * text. Tenancy is structural: every read is scoped by team_id.
 */
export type ListenerRunRequestRow = {
  id: string
  team_id: string
  listener_id: string
  listener_name: string
  creator_uid: string
  creator_user_id: string | null
  source: string
  delivery_id: string
  event_kind: string
  event_summary: string
  payload_digest: string
  target: string
  envelope: string
  state: ListenerRunState
  claimed_by: string | null
  spend_usd: number | null
  created_at: number
  updated_at: number
  expires_at: number
  completed_at: number | null
}

/**
 * Why a claim refused a queued request (next-block spec §6.3). Every
 * refusal is mechanical: the request moves to `refused`, the audit
 * trail gains a `refused_cap` row carrying the reason as its detail,
 * and the listener's creator is notified. `listener_disabled` is the
 * kill switch landing — a new version with `enabled: false` (or a
 * remove, which reads as `listener_removed`) stops the very next claim.
 */
export type ListenerRefusalReason =
  | "listener_disabled"
  | "listener_removed"
  | "listener_invalid"
  | "creator_not_member"
  | "max_runs_per_day"
  | "max_spend_per_day"

export type ListenerClaimResult =
  | { status: "claimed"; request: ListenerRunRequestRow }
  | { status: "refused"; reason: ListenerRefusalReason; request: ListenerRunRequestRow }
  | { status: "expired"; request: ListenerRunRequestRow }
  | { status: "not_claimable"; state: ListenerRunState }
  | { status: "not_found" }

export type ListenerCompleteResult =
  | { status: "completed"; request: ListenerRunRequestRow; overRunCap: boolean }
  | { status: "not_claimable"; state: ListenerRunState }
  | { status: "not_claimant" }
  | { status: "not_found" }

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
    CREATE TABLE IF NOT EXISTS team_memory_entries (
      id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      container TEXT NOT NULL,
      author_uid TEXT NOT NULL,
      author_user_id TEXT,
      outcome TEXT NOT NULL,
      content TEXT NOT NULL,
      signature TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      commit_sha TEXT,
      code_refs TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      superseded_by TEXT,
      PRIMARY KEY (team_id, id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS team_memory_signature
      ON team_memory_entries(team_id, container, signature);
    CREATE INDEX IF NOT EXISTS team_memory_team_seq ON team_memory_entries(team_id, seq);
    CREATE TABLE IF NOT EXISTS team_memory_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      actor_uid TEXT NOT NULL,
      action TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_objects (
      id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      container TEXT NOT NULL,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      author_uid TEXT NOT NULL,
      author_user_id TEXT,
      supersedes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (team_id, id)
    );
    CREATE INDEX IF NOT EXISTS team_objects_team_seq ON team_objects(team_id, seq);
    CREATE INDEX IF NOT EXISTS team_objects_chain
      ON team_objects(team_id, container, kind, name);
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      team_id TEXT NOT NULL,
      source TEXT NOT NULL,
      delivery_id TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, source, delivery_id)
    );
    CREATE TABLE IF NOT EXISTS listener_run_requests (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      listener_id TEXT NOT NULL,
      listener_name TEXT NOT NULL,
      creator_uid TEXT NOT NULL,
      creator_user_id TEXT,
      source TEXT NOT NULL,
      delivery_id TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      event_summary TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      target TEXT NOT NULL,
      envelope TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      claimed_by TEXT,
      spend_usd REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS listener_run_requests_team_state
      ON listener_run_requests(team_id, state, created_at);
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
  // The audit trail is one log for the whole team filesystem (filesystem
  // spec v1 §4): object actions write there too, tagged with their kind.
  // Rows written before the column existed are all memory actions, so the
  // backfill default is exact, not a guess.
  const auditColumns = db.prepare("PRAGMA table_info(team_memory_audit)").all() as {
    name: string
  }[]
  if (!auditColumns.some((column) => column.name === "kind")) {
    db.exec("ALTER TABLE team_memory_audit ADD COLUMN kind TEXT NOT NULL DEFAULT 'memory'")
  }
  // Listener rows carry a detail (drop reason, completion spend) the
  // original verbs never needed; additive and nullable, same pattern.
  if (!auditColumns.some((column) => column.name === "detail")) {
    db.exec("ALTER TABLE team_memory_audit ADD COLUMN detail TEXT")
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
  const insertTeamMemory = db.prepare(
    `INSERT INTO team_memory_entries
       (id, team_id, container, author_uid, author_user_id, outcome, content, signature,
        weight, commit_sha, code_refs, metadata, created_at, updated_at, seq, status, superseded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL)`,
  )
  const selectTeamMemoryById = db.prepare(
    `SELECT * FROM team_memory_entries WHERE team_id = ? AND id = ?`,
  )
  const selectTeamMemoryBySignature = db.prepare(
    `SELECT * FROM team_memory_entries WHERE team_id = ? AND container = ? AND signature = ?`,
  )
  const strengthenTeamMemory = db.prepare(
    `UPDATE team_memory_entries
     SET weight = ?, commit_sha = ?, metadata = ?, updated_at = ?, seq = ?
     WHERE team_id = ? AND id = ?`,
  )
  const archiveTeamMemory = db.prepare(
    `UPDATE team_memory_entries SET status = 'archived', updated_at = ?, seq = ?
     WHERE team_id = ? AND id = ?`,
  )
  const maxTeamMemorySeq = db.prepare(
    `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM team_memory_entries WHERE team_id = ?`,
  )
  const insertTeamMemoryAudit = db.prepare(
    `INSERT INTO team_memory_audit (team_id, kind, actor_uid, action, entry_id, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const selectTeamMemoryAudit = db.prepare(
    `SELECT * FROM team_memory_audit WHERE team_id = ? ORDER BY id ASC`,
  )
  const allTeamIds = db.prepare(`SELECT id FROM teams`)
  const allTeamMemoryForTeam = db.prepare(
    `SELECT * FROM team_memory_entries WHERE team_id = ? ORDER BY seq ASC`,
  )
  const flagTeamMemory = db.prepare(
    `UPDATE team_memory_entries SET status = 'flagged', updated_at = ?, seq = ?
     WHERE team_id = ? AND id = ?`,
  )
  const supersedeTeamMemory = db.prepare(
    `UPDATE team_memory_entries SET superseded_by = ?, updated_at = ?, seq = ?
     WHERE team_id = ? AND id = ?`,
  )
  const decayTeamMemory = db.prepare(
    `UPDATE team_memory_entries SET weight = ?, metadata = ?, seq = ?
     WHERE team_id = ? AND id = ?`,
  )
  const countTeamMemoryByOutcome = db.prepare(
    `SELECT outcome, COUNT(*) AS n FROM team_memory_entries WHERE team_id = ? GROUP BY outcome`,
  )
  const countTeamMemoryByStatus = db.prepare(
    `SELECT status, COUNT(*) AS n FROM team_memory_entries WHERE team_id = ? GROUP BY status`,
  )
  const countTeamMemoryTotal = db.prepare(
    `SELECT COUNT(*) AS n FROM team_memory_entries WHERE team_id = ?`,
  )
  const insertTeamObject = db.prepare(
    `INSERT INTO team_objects
       (id, team_id, kind, container, name, body, metadata, author_uid, author_user_id,
        supersedes, created_at, updated_at, seq, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
  )
  const selectTeamObjectById = db.prepare(
    `SELECT * FROM team_objects WHERE team_id = ? AND id = ?`,
  )
  const selectTeamObjectChain = db.prepare(
    `SELECT * FROM team_objects WHERE team_id = ? AND container = ? AND kind = ? AND name = ?
     ORDER BY seq ASC`,
  )
  const archiveTeamObject = db.prepare(
    `UPDATE team_objects SET status = 'archived', updated_at = ?, seq = ?
     WHERE team_id = ? AND id = ?`,
  )
  const maxTeamObjectSeq = db.prepare(
    `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM team_objects WHERE team_id = ?`,
  )
  const allTeamObjectsForTeam = db.prepare(
    `SELECT * FROM team_objects WHERE team_id = ? ORDER BY seq ASC`,
  )
  const flagTeamObject = db.prepare(
    `UPDATE team_objects SET status = 'flagged', updated_at = ?, seq = ?
     WHERE team_id = ? AND id = ?`,
  )
  const countTeamObjectsByKind = db.prepare(
    `SELECT kind, COUNT(*) AS n FROM team_objects WHERE team_id = ? GROUP BY kind`,
  )
  const countTeamObjectsByStatus = db.prepare(
    `SELECT status, COUNT(*) AS n FROM team_objects WHERE team_id = ? GROUP BY status`,
  )
  const countTeamObjectsTotal = db.prepare(
    `SELECT COUNT(*) AS n FROM team_objects WHERE team_id = ?`,
  )
  // A session "exists for a team" (artifact provenance, filesystem spec
  // v1 §5) when a memory entry the team holds was captured in it — the
  // session id rides in the entry's metadata (spec v2 §5). The gateway
  // keeps no session registry of its own.
  const selectTeamMemorySession = db.prepare(
    `SELECT 1 FROM team_memory_entries
     WHERE team_id = ? AND json_extract(metadata, '$.session_id') = ? LIMIT 1`,
  )
  const insertWebhookDelivery = db.prepare(
    `INSERT OR IGNORE INTO webhook_deliveries (team_id, source, delivery_id, received_at)
     VALUES (?, ?, ?, ?)`,
  )
  const insertListenerRunRequest = db.prepare(
    `INSERT INTO listener_run_requests
       (id, team_id, listener_id, listener_name, creator_uid, creator_user_id, source,
        delivery_id, event_kind, event_summary, payload_digest, target, envelope, state,
        claimed_by, spend_usd, created_at, updated_at, expires_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, ?, ?, ?, NULL)`,
  )
  const selectListenerRunRequest = db.prepare(
    `SELECT * FROM listener_run_requests WHERE team_id = ? AND id = ?`,
  )
  const selectExpiredListenerRunRequests = db.prepare(
    `SELECT * FROM listener_run_requests
     WHERE state = 'queued' AND expires_at <= ? ORDER BY created_at ASC`,
  )
  const expireListenerRunRequest = db.prepare(
    `UPDATE listener_run_requests SET state = 'expired', updated_at = ?
     WHERE team_id = ? AND id = ? AND state = 'queued'`,
  )
  // Runner lifecycle (S-LIS2): every transition is a state-guarded
  // UPDATE, so a claim is atomic — two runners racing one request
  // cannot both move it out of `queued`.
  const claimListenerRunRequest = db.prepare(
    `UPDATE listener_run_requests SET state = 'claimed', claimed_by = ?, updated_at = ?
     WHERE team_id = ? AND id = ? AND state = 'queued'`,
  )
  const refuseListenerRunRequest = db.prepare(
    `UPDATE listener_run_requests SET state = 'refused', updated_at = ?
     WHERE team_id = ? AND id = ? AND state = 'queued'`,
  )
  const completeListenerRunRequest = db.prepare(
    `UPDATE listener_run_requests SET state = 'completed', spend_usd = ?, completed_at = ?, updated_at = ?
     WHERE team_id = ? AND id = ? AND state = 'claimed'`,
  )
  const requeueListenerRunRequest = db.prepare(
    `UPDATE listener_run_requests SET state = 'queued', claimed_by = NULL, updated_at = ?
     WHERE team_id = ? AND id = ? AND state = 'claimed'`,
  )
  const expireClaimedListenerRunRequest = db.prepare(
    `UPDATE listener_run_requests SET state = 'expired', updated_at = ?
     WHERE team_id = ? AND id = ? AND state = 'claimed'`,
  )
  const selectStaleClaimedListenerRunRequests = db.prepare(
    `SELECT * FROM listener_run_requests
     WHERE state = 'claimed' AND updated_at <= ? ORDER BY updated_at ASC`,
  )
  const countListenerClaimsForRequest = db.prepare(
    `SELECT COUNT(*) AS n FROM team_memory_audit
     WHERE team_id = ? AND kind = 'listener' AND action = 'claimed' AND entry_id = ?`,
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

  /** Next per-team change-feed cursor for team memory (spec v2 §5). */
  function nextTeamMemorySeq(teamId: string): number {
    return (maxTeamMemorySeq.get(teamId) as { max_seq: number }).max_seq + 1
  }

  /**
   * Next per-team change-feed cursor for team objects. Objects keep their
   * own seq space (filesystem spec v1 §6): a cursor cannot be shared
   * across two tables whose rows are allocated by MAX(seq)+1 within each.
   */
  function nextTeamObjectSeq(teamId: string): number {
    return (maxTeamObjectSeq.get(teamId) as { max_seq: number }).max_seq + 1
  }

  /**
   * The D-FS5 predicate seam (filesystem spec v1 §8): every object read
   * path funnels through here, so per-container ACLs — and later
   * initiator-scoped permissions — slot in as a predicate over data that
   * already exists (author_uid, container) without API or client changes.
   * In v1, team membership is the whole access control, so any row in the
   * caller's team is visible to them.
   */
  function teamObjectVisibleTo(row: TeamObjectRow, actor: { uid: string }): boolean {
    // v1: membership is the whole access control — reads reach this
    // predicate only with rows already scoped to the actor's team.
    return true
  }

  /** The tip of a supersede chain: the row no other chain row supersedes. */
  function chainTip(chain: TeamObjectRow[]): TeamObjectRow | undefined {
    const superseded = new Set(
      chain.map((row) => row.supersedes).filter((id): id is string => id !== null),
    )
    let tip: TeamObjectRow | undefined
    for (const row of chain) {
      if (superseded.has(row.id)) continue
      if (!tip || row.seq > tip.seq) tip = row
    }
    return tip
  }

  /**
   * Expire one queued request with its `expired` audit row and creator
   * notification (next-block spec §6.1: expiry is never silent). Shared
   * by the TTL sweep and the claim path, which expires a past-TTL
   * request inline rather than claiming it.
   */
  function expireQueuedListenerRequest(row: ListenerRunRequestRow, now: number) {
    expireListenerRunRequest.run(now, row.team_id, row.id)
    insertTeamMemoryAudit.run(row.team_id, "listener", "gateway", "expired", row.id, null, now)
    notify(row.creator_uid, "listener_request_expired", {
      request_id: row.id,
      listener_id: row.listener_id,
      listener_name: row.listener_name,
    })
  }

  /**
   * The mechanical claim-time envelope decision for one queued request
   * (next-block spec §6.3, S-LIS2): undefined admits the claim,
   * anything else is the refusal reason. Liveness comes from the
   * listener's current chain head; the numbers come from the envelope
   * snapshot the request carries from fire time. Day boundaries are
   * UTC — one boundary for every runner, stated here rather than
   * implied.
   */
  function listenerClaimRefusal(
    row: ListenerRunRequestRow,
    now: number,
  ): ListenerRefusalReason | undefined {
    const fired = selectTeamObjectById.get(row.team_id, row.listener_id) as
      | TeamObjectRow
      | undefined
    if (!fired) return "listener_removed"
    const chain = selectTeamObjectChain.all(
      row.team_id,
      fired.container,
      "listener",
      fired.name,
    ) as TeamObjectRow[]
    const tip = chainTip(chain)
    if (!tip || tip.status !== "active") return "listener_removed"
    const definition = parseListenerDefinition(tip.body)
    if (!definition) return "listener_invalid"
    if (!definition.enabled) return "listener_disabled"
    const membership = selectMembership.get(row.creator_uid) as TeamMemberRow | undefined
    if (!membership || membership.team_id !== row.team_id) return "creator_not_member"
    const envelope = parseListenerEnvelope(JSON.parse(row.envelope) as unknown)
    if (!envelope) return "listener_invalid"
    const chainIds = chain.map((entry) => entry.id)
    if (chainIds.length === 0) return undefined
    const marks = chainIds.map(() => "?").join(", ")
    const dayStart = Math.floor(now / 86_400_000) * 86_400_000
    const claimedToday = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT a.entry_id) AS n FROM team_memory_audit a
           JOIN listener_run_requests r ON r.id = a.entry_id AND r.team_id = a.team_id
           WHERE a.team_id = ? AND a.kind = 'listener' AND a.action = 'claimed' AND a.at >= ?
             AND r.listener_id IN (${marks})`,
        )
        .get(row.team_id, dayStart, ...chainIds) as { n: number }
    ).n
    if (claimedToday >= envelope.max_runs_per_day) return "max_runs_per_day"
    const spentToday = (
      db
        .prepare(
          `SELECT COALESCE(SUM(spend_usd), 0) AS total FROM listener_run_requests
           WHERE team_id = ? AND state = 'completed' AND completed_at >= ?
             AND listener_id IN (${marks})`,
        )
        .get(row.team_id, dayStart, ...chainIds) as { total: number }
    ).total
    const outstanding = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM listener_run_requests
           WHERE team_id = ? AND state = 'claimed' AND listener_id IN (${marks})`,
        )
        .get(row.team_id, ...chainIds) as { n: number }
    ).n
    const exposure = spentToday + (outstanding + 1) * envelope.max_spend_per_run_usd
    if (exposure > envelope.max_spend_per_day_usd + 1e-9) return "max_spend_per_day"
    return undefined
  }

  /** The team's webhook intake config from its settings row. */
  function teamWebhookConfig(teamId: string): TeamWebhookConfig | undefined {    const row = getSetting.get(`team_webhook:${teamId}`) as { value: string } | undefined
    if (!row) return undefined
    try {
      const parsed = JSON.parse(row.value) as Partial<TeamWebhookConfig>
      if (typeof parsed.secret !== "string" || typeof parsed.created_at !== "number") {
        return undefined
      }
      return { secret: parsed.secret, created_at: parsed.created_at }
    } catch {
      return undefined
    }
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

    getAccountByInvite(code: string): AccountRow | undefined {
      return selectAccountByInvite.get(code) as AccountRow | undefined
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

    /**
     * Apply one validated push entry to a team's memory store (spec v2
     * §§5–7). Tenancy is structural: every statement is scoped by team_id,
     * so an unscoped read or write cannot be expressed through this API.
     *
     * - Same entry id again → idempotent replay (no mutation, no audit):
     *   a harness retrying a queued push must not double-store or inflate.
     * - New id, same (container, signature) → strengthened: weight grows by
     *   the incoming weight, the verifier joins `also_verified_by`, and the
     *   row takes a fresh seq so mirrors re-pull it.
     * - A signature (or id) whose row was removed → rejected: removals are
     *   deliberate, and a stale queued push must not resurrect them.
     */
    pushTeamMemoryEntry(
      teamId: string,
      actor: { uid: string; userId: string | null },
      input: TeamMemoryPushInput,
    ): TeamMemoryPushResult {
      const at = Date.now()
      let result: TeamMemoryPushResult | undefined
      db.transaction(() => {
        const byId = selectTeamMemoryById.get(teamId, input.id) as TeamMemoryRow | undefined
        if (byId) {
          result =
            byId.status === "archived"
              ? { status: "rejected", reason: "archived" }
              : { status: "stored", entry: byId, replayed: true }
          return
        }
        const bySignature = selectTeamMemoryBySignature.get(
          teamId,
          input.container,
          input.signature,
        ) as TeamMemoryRow | undefined
        if (bySignature) {
          if (bySignature.status === "archived") {
            result = { status: "rejected", reason: "archived" }
            return
          }
          const metadata = JSON.parse(bySignature.metadata) as Record<string, unknown>
          const verifiers = new Set(
            Array.isArray(metadata.also_verified_by)
              ? metadata.also_verified_by.filter((v): v is string => typeof v === "string")
              : [],
          )
          if (actor.userId && actor.userId !== bySignature.author_user_id) verifiers.add(actor.userId)
          metadata.also_verified_by = [...verifiers]
          strengthenTeamMemory.run(
            bySignature.weight + input.weight,
            input.commitSha ?? bySignature.commit_sha,
            JSON.stringify(metadata),
            at,
            nextTeamMemorySeq(teamId),
            teamId,
            bySignature.id,
          )
          insertTeamMemoryAudit.run(teamId, "memory", actor.uid, "strengthen", bySignature.id, null, at)
          result = {
            status: "strengthened",
            entry: selectTeamMemoryById.get(teamId, bySignature.id) as TeamMemoryRow,
          }
          return
        }
        insertTeamMemory.run(
          input.id,
          teamId,
          input.container,
          actor.uid,
          actor.userId,
          input.outcome,
          input.content,
          input.signature,
          input.weight,
          input.commitSha,
          JSON.stringify(input.codeRefs),
          JSON.stringify(input.metadata),
          input.createdAt,
          at,
          nextTeamMemorySeq(teamId),
        )
        insertTeamMemoryAudit.run(teamId, "memory", actor.uid, "store", input.id, null, at)
        result = {
          status: "stored",
          entry: selectTeamMemoryById.get(teamId, input.id) as TeamMemoryRow,
          replayed: false,
        }
      })()
      if (!result) throw new Error("team memory push produced no result")
      return result
    },

    /**
     * Incremental pull for one team (spec v2 §6): active entries with
     * seq > sinceSeq in seq order, plus the ids archived since sinceSeq so
     * local mirrors converge. An optional container filter scopes both.
     */
    pullTeamMemory(
      teamId: string,
      sinceSeq: number,
      containers?: string[],
    ): { entries: TeamMemoryRow[]; tombstones: string[]; nextSeq: number } {
      const scope = containers && containers.length > 0 ? containers : undefined
      const marks = scope ? scope.map(() => "?").join(", ") : ""
      const entries = (
        scope
          ? db
              .prepare(
                `SELECT * FROM team_memory_entries
                 WHERE team_id = ? AND status = 'active' AND seq > ? AND container IN (${marks})
                 ORDER BY seq ASC`,
              )
              .all(teamId, sinceSeq, ...scope)
          : db
              .prepare(
                `SELECT * FROM team_memory_entries
                 WHERE team_id = ? AND status = 'active' AND seq > ?
                 ORDER BY seq ASC`,
              )
              .all(teamId, sinceSeq)
      ) as TeamMemoryRow[]
      const tombstones = (
        scope
          ? db
              .prepare(
                `SELECT id FROM team_memory_entries
                 WHERE team_id = ? AND status = 'archived' AND seq > ? AND container IN (${marks})`,
              )
              .all(teamId, sinceSeq, ...scope)
          : db
              .prepare(
                `SELECT id FROM team_memory_entries
                 WHERE team_id = ? AND status = 'archived' AND seq > ?`,
              )
              .all(teamId, sinceSeq)
      ) as { id: string }[]
      return {
        entries,
        tombstones: tombstones.map((row) => row.id),
        nextSeq: (maxTeamMemorySeq.get(teamId) as { max_seq: number }).max_seq,
      }
    },

    /**
     * Remove one entry (spec v2 §6): the author, or a team owner/admin.
     * Removal archives the row and gives it a fresh seq, so the removal
     * itself travels the pull feed as a tombstone; the row (and its audit
     * trail) stays server-side. Idempotent for an already-archived entry.
     */
    removeTeamMemoryEntry(
      teamId: string,
      entryId: string,
      actor: { uid: string; role: TeamRole },
    ): { ok: true } | { ok: false; reason: "not_found" | "not_authorized" } {
      const row = selectTeamMemoryById.get(teamId, entryId) as TeamMemoryRow | undefined
      if (!row) return { ok: false, reason: "not_found" }
      if (row.author_uid !== actor.uid && actor.role !== "owner" && actor.role !== "admin") {
        return { ok: false, reason: "not_authorized" }
      }
      if (row.status === "archived") return { ok: true }
      const at = Date.now()
      db.transaction(() => {
        archiveTeamMemory.run(at, nextTeamMemorySeq(teamId), teamId, entryId)
        insertTeamMemoryAudit.run(teamId, "memory", actor.uid, "remove", entryId, null, at)
      })()
      return { ok: true }
    },

    /** Browse a team's memory (dashboard + CLI surface), newest first. */
    listTeamMemory(
      teamId: string,
      filters?: { container?: string; outcome?: string; authorUserId?: string; limit?: number },
    ): TeamMemoryRow[] {
      const clauses = ["team_id = ?"]
      const params: (string | number)[] = [teamId]
      if (filters?.container) {
        clauses.push("container = ?")
        params.push(filters.container)
      }
      if (filters?.outcome) {
        clauses.push("outcome = ?")
        params.push(filters.outcome)
      }
      if (filters?.authorUserId) {
        clauses.push("author_user_id = ?")
        params.push(filters.authorUserId)
      }
      const limit = Math.min(200, Math.max(1, Math.floor(filters?.limit ?? 100)))
      return db
        .prepare(
          `SELECT * FROM team_memory_entries WHERE ${clauses.join(" AND ")}
           ORDER BY created_at DESC, seq DESC LIMIT ?`,
        )
        .all(...params, limit) as TeamMemoryRow[]
    },

    /** The audit trail for a team's memory (spec v2 §7): who did what to
     * which entry, when — never entry bodies. */
    teamMemoryAudit(teamId: string): TeamMemoryAuditRow[] {
      return selectTeamMemoryAudit.all(teamId) as TeamMemoryAuditRow[]
    },

    /**
     * Apply one validated object push to a team's filesystem store
     * (filesystem spec v1 §§4–5). Admission — per-kind schema validity and
     * the secrets scan — already happened in the HTTP layer; this method
     * owns chain integrity. Tenancy is structural, as with memory.
     *
     * - Same object id again with identical content → idempotent replay
     *   (no mutation, no audit): a harness retrying a queued push must
     *   not fork the chain or double-store.
     * - Same id, different content → rejected `id_conflict`: ids are
     *   immutable version identities; an edit is a NEW id superseding
     *   the current head.
     * - A push into a chain whose tip was removed → rejected `archived`:
     *   removals are deliberate, and a stale queued edit must not
     *   resurrect the chain.
     * - `supersedes` naming no row in this team → `supersedes_not_found`
     *   (a guessed foreign id is indistinguishable from a typo — nothing
     *   about the other team leaks). Naming a row that is not the named
     *   chain's current tip → `stale_head`: v1 chains are linear, so a
     *   second edit off the same head is a fork the store will not take.
     * - A fresh root (supersedes null) for a name that already has a live
     *   chain → `name_taken`: edit the head instead.
     * - The old head keeps status `active` after an edit — it leaves
     *   "current" via the chain, and archiving superseded rows is the
     *   policy sweep's job (S-FS3), exactly as with memory.
     */
    pushTeamObject(
      teamId: string,
      actor: { uid: string; userId: string | null },
      input: TeamObjectPushInput,
    ): TeamObjectPushResult {
      const at = Date.now()
      let result: TeamObjectPushResult | undefined
      db.transaction(() => {
        const byId = selectTeamObjectById.get(teamId, input.id) as TeamObjectRow | undefined
        if (byId) {
          if (byId.status === "archived") {
            result = { status: "rejected", reason: "archived" }
            return
          }
          const identical =
            byId.kind === input.kind &&
            byId.container === input.container &&
            byId.name === input.name &&
            byId.body === input.body &&
            byId.metadata === JSON.stringify(input.metadata) &&
            byId.supersedes === input.supersedes
          result = identical
            ? { status: "stored", object: byId, replayed: true }
            : { status: "rejected", reason: "id_conflict" }
          return
        }
        if (input.supersedes) {
          const target = selectTeamObjectById.get(teamId, input.supersedes) as
            | TeamObjectRow
            | undefined
          if (!target) {
            result = { status: "rejected", reason: "supersedes_not_found" }
            return
          }
          if (target.status === "archived") {
            result = { status: "rejected", reason: "archived" }
            return
          }
        }
        const chain = selectTeamObjectChain.all(
          teamId,
          input.container,
          input.kind,
          input.name,
        ) as TeamObjectRow[]
        const tip = chainTip(chain)
        if (input.supersedes) {
          if (!tip || input.supersedes !== tip.id) {
            result = { status: "rejected", reason: "stale_head" }
            return
          }
        } else if (tip) {
          result =
            tip.status === "archived"
              ? { status: "rejected", reason: "archived" }
              : { status: "rejected", reason: "name_taken" }
          return
        }
        insertTeamObject.run(
          input.id,
          teamId,
          input.kind,
          input.container,
          input.name,
          input.body,
          JSON.stringify(input.metadata),
          actor.uid,
          actor.userId,
          input.supersedes,
          at,
          at,
          nextTeamObjectSeq(teamId),
        )
        insertTeamMemoryAudit.run(
          teamId,
          input.kind,
          actor.uid,
          input.supersedes ? "edit" : "store",
          input.id,
          null,
          at,
        )
        result = {
          status: "stored",
          object: selectTeamObjectById.get(teamId, input.id) as TeamObjectRow,
          replayed: false,
        }
      })()
      if (!result) throw new Error("team object push produced no result")
      return result
    },

    /**
     * Incremental pull for one team's objects (filesystem spec v1 §6):
     * chain HEADS only — a row some other row supersedes is history, not
     * current — with seq > sinceSeq in the objects' own seq space, plus
     * the ids archived since sinceSeq so local mirrors converge. Kind and
     * container filters scope both halves.
     */
    pullTeamObjects(
      teamId: string,
      actor: { uid: string },
      sinceSeq: number,
      filters?: { kinds?: TeamObjectKind[]; containers?: string[] },
    ): { objects: TeamObjectRow[]; tombstones: string[]; nextSeq: number } {
      const clauses = ["team_id = ?", "seq > ?"]
      const params: (string | number)[] = [teamId, sinceSeq]
      if (filters?.kinds && filters.kinds.length > 0) {
        clauses.push(`kind IN (${filters.kinds.map(() => "?").join(", ")})`)
        params.push(...filters.kinds)
      }
      if (filters?.containers && filters.containers.length > 0) {
        clauses.push(`container IN (${filters.containers.map(() => "?").join(", ")})`)
        params.push(...filters.containers)
      }
      const where = clauses.join(" AND ")
      const heads = db
        .prepare(
          `SELECT * FROM team_objects
           WHERE ${where} AND status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM team_objects newer
               WHERE newer.team_id = team_objects.team_id AND newer.supersedes = team_objects.id
             )
           ORDER BY seq ASC`,
        )
        .all(...params) as TeamObjectRow[]
      const tombstones = db
        .prepare(`SELECT id FROM team_objects WHERE ${where} AND status = 'archived'`)
        .all(...params) as { id: string }[]
      return {
        objects: heads.filter((row) => teamObjectVisibleTo(row, actor)),
        tombstones: tombstones.map((row) => row.id),
        nextSeq: (maxTeamObjectSeq.get(teamId) as { max_seq: number }).max_seq,
      }
    },

    /**
     * Remove one object (filesystem spec v1 §6): the author, or a team
     * owner/admin — memory's semantics exactly. Removal archives the row
     * and gives it a fresh seq, so the removal travels the pull feed as a
     * tombstone; the row (and its audit trail) stays server-side.
     * Idempotent for an already-archived object.
     */
    removeTeamObject(
      teamId: string,
      objectId: string,
      actor: { uid: string; role: TeamRole },
    ): { ok: true } | { ok: false; reason: "not_found" | "not_authorized" } {
      const row = selectTeamObjectById.get(teamId, objectId) as TeamObjectRow | undefined
      if (!row) return { ok: false, reason: "not_found" }
      if (row.author_uid !== actor.uid && actor.role !== "owner" && actor.role !== "admin") {
        return { ok: false, reason: "not_authorized" }
      }
      if (row.status === "archived") return { ok: true }
      const at = Date.now()
      db.transaction(() => {
        archiveTeamObject.run(at, nextTeamObjectSeq(teamId), teamId, objectId)
        insertTeamMemoryAudit.run(teamId, row.kind, actor.uid, "remove", objectId, null, at)
      })()
      return { ok: true }
    },

    /**
     * Browse a team's objects (dashboard + history surface), newest
     * first. Unlike pull, list returns every row — heads and retained
     * history alike — each tagged `is_head`, so a chain's full version
     * history is reachable by filtering to one (container, kind, name).
     */
    listTeamObjects(
      teamId: string,
      actor: { uid: string },
      filters?: {
        container?: string
        kind?: string
        name?: string
        authorUserId?: string
        headOnly?: boolean
        limit?: number
      },
    ): TeamObjectListRow[] {
      const clauses = ["team_id = ?"]
      const params: (string | number)[] = [teamId]
      if (filters?.container) {
        clauses.push("container = ?")
        params.push(filters.container)
      }
      if (filters?.kind) {
        clauses.push("kind = ?")
        params.push(filters.kind)
      }
      if (filters?.name) {
        clauses.push("name = ?")
        params.push(filters.name)
      }
      if (filters?.authorUserId) {
        clauses.push("author_user_id = ?")
        params.push(filters.authorUserId)
      }
      if (filters?.headOnly) {
        clauses.push(
          `NOT EXISTS (
             SELECT 1 FROM team_objects newer
             WHERE newer.team_id = team_objects.team_id AND newer.supersedes = team_objects.id
           )`,
        )
      }
      const limit = Math.min(200, Math.max(1, Math.floor(filters?.limit ?? 100)))
      const rows = db
        .prepare(
          `SELECT *,
             NOT EXISTS (
               SELECT 1 FROM team_objects newer
               WHERE newer.team_id = team_objects.team_id AND newer.supersedes = team_objects.id
             ) AS is_head
           FROM team_objects WHERE ${clauses.join(" AND ")}
           ORDER BY created_at DESC, seq DESC LIMIT ?`,
        )
        .all(...params, limit) as TeamObjectListRow[]
      return rows.filter((row) => teamObjectVisibleTo(row, actor))
    },

    /** Team-wide object counts for the dashboard browser (filesystem
     * spec v1 §9): totals across all statuses, not just the list window. */
    teamObjectCounts(teamId: string): TeamObjectCounts {
      const byKind: Record<string, number> = {}
      for (const row of countTeamObjectsByKind.all(teamId) as { kind: string; n: number }[]) {
        byKind[row.kind] = row.n
      }
      const byStatus: Record<string, number> = {}
      for (const row of countTeamObjectsByStatus.all(teamId) as { status: string; n: number }[]) {
        byStatus[row.status] = row.n
      }
      return {
        total: (countTeamObjectsTotal.get(teamId) as { n: number }).n,
        byKind,
        byStatus,
      }
    },

    /** A team row by id — the webhook intake's tenancy anchor: the team
     * a delivery is addressed to, before any credential exists. */
    getTeam(teamId: string): TeamRow | undefined {
      return selectTeam.get(teamId) as TeamRow | undefined
    },

    /**
     * Append one row to the unified audit trail from outside the store's
     * own mutation methods — the webhook intake's drops happen in the
     * HTTP layer, where no store mutation exists to carry the audit.
     * Kind `listener` rows follow next-block spec §6.3.
     */
    appendTeamAudit(input: {
      teamId: string
      kind: string
      actorUid: string
      action: string
      entryId: string
      detail?: string | null
    }) {
      insertTeamMemoryAudit.run(
        input.teamId,
        input.kind,
        input.actorUid,
        input.action,
        input.entryId,
        input.detail ?? null,
        Date.now(),
      )
    },

    /** The team's listener ceiling (next-block spec §6.4, D16), if an
     * owner/admin has set one. Settings-backed, like the dreaming runs. */
    getListenerCeiling(teamId: string): ListenerCeiling | undefined {
      const row = getSetting.get(`listener_ceiling:${teamId}`) as { value: string } | undefined
      if (!row) return undefined
      try {
        const parsed = JSON.parse(row.value) as Partial<ListenerCeiling>
        if (
          typeof parsed.max_runs_per_day !== "number" ||
          typeof parsed.max_spend_per_day_usd !== "number" ||
          typeof parsed.max_spend_per_run_usd !== "number"
        ) {
          return undefined
        }
        return {
          max_runs_per_day: parsed.max_runs_per_day,
          max_spend_per_day_usd: parsed.max_spend_per_day_usd,
          max_spend_per_run_usd: parsed.max_spend_per_run_usd,
        }
      } catch {
        return undefined
      }
    },

    setListenerCeiling(teamId: string, ceiling: ListenerCeiling) {
      setSetting.run(`listener_ceiling:${teamId}`, JSON.stringify(ceiling))
    },

    /** The team's webhook intake config, if intake was ever set up. */
    getTeamWebhookConfig(teamId: string): TeamWebhookConfig | undefined {
      return teamWebhookConfig(teamId)
    },

    /** Fetch the team's webhook secret, minting one on first setup. */
    ensureTeamWebhookSecret(teamId: string): TeamWebhookConfig & { created: boolean } {
      const existing = teamWebhookConfig(teamId)
      if (existing) return { ...existing, created: false }
      const config = { secret: generateDeviceSecret(), created_at: Date.now() }
      setSetting.run(`team_webhook:${teamId}`, JSON.stringify(config))
      return { ...config, created: true }
    },

    /** Replace the team's webhook secret (the old one dies immediately). */
    rotateTeamWebhookSecret(teamId: string): TeamWebhookConfig {
      const config = { secret: generateDeviceSecret(), created_at: Date.now() }
      setSetting.run(`team_webhook:${teamId}`, JSON.stringify(config))
      return config
    },

    /**
     * Delivery-id dedupe (next-block spec §6.1): record a delivery the
     * first time it is seen. Returns false when this (team, source,
     * delivery id) was already recorded — a replay, which intake drops.
     */
    recordWebhookDelivery(input: {
      teamId: string
      source: string
      deliveryId: string
      at: number
    }): boolean {
      return (
        insertWebhookDelivery.run(input.teamId, input.source, input.deliveryId, input.at)
          .changes > 0
      )
    },

    /**
     * Queue one run request for a matched listener (next-block spec
     * §6.2) and write the `fired` + `queued` audit rows in the same
     * transaction — a request never exists without its trail. `fired`
     * keys on the listener object id; `queued` keys on the request id,
     * as do the lifecycle rows that follow it (claimed/completed/…).
     */
    enqueueListenerRun(input: {
      teamId: string
      listenerId: string
      listenerName: string
      creatorUid: string
      creatorUserId: string | null
      source: string
      deliveryId: string
      eventKind: string
      eventSummary: Record<string, unknown>
      payloadDigest: string
      target: Record<string, unknown>
      envelope: ListenerCeiling
      expiresAt: number
    }): ListenerRunRequestRow {
      let id = generateRunRequestId()
      while (selectListenerRunRequest.get(input.teamId, id)) id = generateRunRequestId()
      const at = Date.now()
      db.transaction(() => {
        insertListenerRunRequest.run(
          id,
          input.teamId,
          input.listenerId,
          input.listenerName,
          input.creatorUid,
          input.creatorUserId,
          input.source,
          input.deliveryId,
          input.eventKind,
          JSON.stringify(input.eventSummary),
          input.payloadDigest,
          JSON.stringify(input.target),
          JSON.stringify(input.envelope),
          at,
          at,
          input.expiresAt,
        )
        insertTeamMemoryAudit.run(
          input.teamId,
          "listener",
          input.creatorUid,
          "fired",
          input.listenerId,
          null,
          at,
        )
        insertTeamMemoryAudit.run(
          input.teamId,
          "listener",
          input.creatorUid,
          "queued",
          id,
          null,
          at,
        )
      })()
      return selectListenerRunRequest.get(input.teamId, id) as ListenerRunRequestRow
    },

    /** Browse a team's run-request queue, newest first — the surface a
     * runner (S-LIS2) and the dashboard read; tenancy-scoped as always. */
    listListenerRunRequests(
      teamId: string,
      filters?: { state?: string; listenerId?: string; limit?: number },
    ): ListenerRunRequestRow[] {
      const clauses = ["team_id = ?"]
      const params: (string | number)[] = [teamId]
      if (filters?.state) {
        clauses.push("state = ?")
        params.push(filters.state)
      }
      if (filters?.listenerId) {
        clauses.push("listener_id = ?")
        params.push(filters.listenerId)
      }
      const limit = Math.min(200, Math.max(1, Math.floor(filters?.limit ?? 100)))
      return db
        .prepare(
          `SELECT * FROM listener_run_requests WHERE ${clauses.join(" AND ")}
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(...params, limit) as ListenerRunRequestRow[]
    },

    /**
     * Expire queued requests past their TTL (next-block spec §6.1):
     * nothing is lost silently — each expiry writes an `expired` audit
     * row and notifies the listener's creator. Driven by the policy
     * timer (policy.ts); idempotent, since only `queued` rows move.
     */
    expireListenerRunRequests(input: { now: number }): ListenerRunRequestRow[] {
      const rows = selectExpiredListenerRunRequests.all(input.now) as ListenerRunRequestRow[]
      if (rows.length === 0) return []
      db.transaction(() => {
        for (const row of rows) expireQueuedListenerRequest(row, input.now)
      })()
      return rows.map((row) => ({ ...row, state: "expired" as const, updated_at: input.now }))
    },

    /** One queue row by id, tenancy-scoped — the claim/complete surface. */
    getListenerRunRequest(teamId: string, requestId: string): ListenerRunRequestRow | undefined {
      return selectListenerRunRequest.get(teamId, requestId) as ListenerRunRequestRow | undefined
    },

    /**
     * Claim one queued request for a runner (next-block spec §6.3,
     * S-LIS2). The whole decision is mechanical and happens in one
     * transaction, in this order:
     *
     * 1. A request past its queue TTL expires inline (same audit +
     *    notification as the sweep) instead of being claimed.
     * 2. The listener's CURRENT chain head governs liveness: archived
     *    or missing reads as removed; `enabled: false` is the kill
     *    switch and refuses this claim — the very next one after the
     *    disabling version lands.
     * 3. The creator must still belong to the team (re-read per claim,
     *    as intake re-reads per delivery).
     * 4. Runs/day counts today's `claimed` audit rows for the
     *    listener's chain (distinct requests — a re-claimed request is
     *    one run, not two).
     * 5. Spend/day counts what the data honestly supports: completed
     *    rows' recorded spend landed today, plus every outstanding
     *    claim (including this one) at its full per-run cap — the
     *    worst case each claim commits the envelope to. The per-run
     *    cap itself can only be judged at completion (the money is
     *    spent by then); completion records and flags an overage
     *    rather than pretending claim time could have prevented it.
     *
     * Any refusal moves the request to `refused` with a `refused_cap`
     * audit row (detail = the reason) and a creator notification —
     * until S-INBOX1, over-envelope requests are refused, never parked
     * (§6.3 interim behavior). The claim itself is a state-guarded
     * UPDATE: exactly one runner can win a request.
     */
    claimListenerRunRequest(input: {
      teamId: string
      requestId: string
      claimantUid: string
      now?: number
    }): ListenerClaimResult {
      const now = input.now ?? Date.now()
      const row = selectListenerRunRequest.get(input.teamId, input.requestId) as
        | ListenerRunRequestRow
        | undefined
      if (!row) return { status: "not_found" }
      if (row.state !== "queued") return { status: "not_claimable", state: row.state }
      let result: ListenerClaimResult | undefined
      db.transaction(() => {
        if (row.expires_at <= now) {
          expireQueuedListenerRequest(row, now)
          result = {
            status: "expired",
            request: selectListenerRunRequest.get(input.teamId, row.id) as ListenerRunRequestRow,
          }
          return
        }
        const refusal = listenerClaimRefusal(row, now)
        if (refusal) {
          refuseListenerRunRequest.run(now, input.teamId, row.id)
          insertTeamMemoryAudit.run(
            input.teamId,
            "listener",
            "gateway",
            "refused_cap",
            row.id,
            refusal,
            now,
          )
          notify(row.creator_uid, "listener_request_refused", {
            request_id: row.id,
            listener_id: row.listener_id,
            listener_name: row.listener_name,
            reason: refusal,
          })
          result = {
            status: "refused",
            reason: refusal,
            request: selectListenerRunRequest.get(input.teamId, row.id) as ListenerRunRequestRow,
          }
          return
        }
        const claimed = claimListenerRunRequest.run(input.claimantUid, now, input.teamId, row.id)
        if (claimed.changes === 0) {
          const fresh = selectListenerRunRequest.get(input.teamId, row.id) as ListenerRunRequestRow
          result = { status: "not_claimable", state: fresh.state }
          return
        }
        insertTeamMemoryAudit.run(
          input.teamId,
          "listener",
          input.claimantUid,
          "claimed",
          row.id,
          null,
          now,
        )
        result = {
          status: "claimed",
          request: selectListenerRunRequest.get(input.teamId, row.id) as ListenerRunRequestRow,
        }
      })()
      if (!result) throw new Error("listener claim produced no result")
      return result
    },

    /**
     * Report a claimed run's end (next-block spec §6.2: the audit loop
     * closes claimed → completed, with spend). Only the runner that
     * claimed the request may report it. A failed run is still a
     * completed lifecycle — the state models no separate failure
     * terminal — with the outcome (and the runner's error, truncated)
     * carried in the audit detail and the creator notification, so a
     * failure is never dressed up as a success. Spend above the
     * per-run cap is recorded as reported and flagged
     * `over_run_cap`: the gateway cannot un-spend money, so the
     * overage is made visible instead of hidden.
     */
    completeListenerRunRequest(input: {
      teamId: string
      requestId: string
      claimantUid: string
      spendUsd: number
      outcome: "succeeded" | "failed"
      sessionId?: string
      error?: string
      now?: number
    }): ListenerCompleteResult {
      const now = input.now ?? Date.now()
      const row = selectListenerRunRequest.get(input.teamId, input.requestId) as
        | ListenerRunRequestRow
        | undefined
      if (!row) return { status: "not_found" }
      if (row.state !== "claimed") return { status: "not_claimable", state: row.state }
      if (row.claimed_by !== input.claimantUid) return { status: "not_claimant" }
      const envelope = parseListenerEnvelope(JSON.parse(row.envelope) as unknown)
      const overRunCap = envelope ? input.spendUsd > envelope.max_spend_per_run_usd + 1e-9 : false
      db.transaction(() => {
        completeListenerRunRequest.run(input.spendUsd, now, now, input.teamId, row.id)
        const detail: Record<string, unknown> = {
          spend_usd: input.spendUsd,
          outcome: input.outcome,
        }
        if (input.sessionId) detail.session_id = input.sessionId
        if (input.error) detail.error = input.error.slice(0, 500)
        if (overRunCap) detail.over_run_cap = true
        insertTeamMemoryAudit.run(
          input.teamId,
          "listener",
          input.claimantUid,
          "completed",
          row.id,
          JSON.stringify(detail),
          now,
        )
        notify(row.creator_uid, "listener_request_completed", {
          request_id: row.id,
          listener_id: row.listener_id,
          listener_name: row.listener_name,
          spend_usd: input.spendUsd,
          outcome: input.outcome,
          ...(overRunCap ? { over_run_cap: true } : {}),
        })
      })()
      return {
        status: "completed",
        request: selectListenerRunRequest.get(input.teamId, row.id) as ListenerRunRequestRow,
        overRunCap,
      }
    },

    /**
     * Claim-lease sweep (S-LIS2): a claimed row whose runner never
     * reports must not wedge forever. A row claimed longer than the
     * lease is REQUEUED ONCE (a crashed runner gets one retry; the
     * queue TTL still bounds the request's total life) — a row whose
     * lease lapses a second time EXPIRES, audited and notified like
     * any expiry. Attempt counting rides the audit trail: one
     * `claimed` row per claim, so no extra bookkeeping column exists.
     * Driven by the policy timer (policy.ts); idempotent, since only
     * `claimed` rows past the lease move.
     */
    sweepListenerClaimLeases(input: { now: number; leaseMs: number }): {
      requeued: ListenerRunRequestRow[]
      expired: ListenerRunRequestRow[]
    } {
      const stale = selectStaleClaimedListenerRunRequests.all(
        input.now - input.leaseMs,
      ) as ListenerRunRequestRow[]
      const requeued: ListenerRunRequestRow[] = []
      const expired: ListenerRunRequestRow[] = []
      if (stale.length === 0) return { requeued, expired }
      db.transaction(() => {
        for (const row of stale) {
          const claims = (countListenerClaimsForRequest.get(row.team_id, row.id) as { n: number }).n
          if (claims <= 1) {
            requeueListenerRunRequest.run(input.now, row.team_id, row.id)
            insertTeamMemoryAudit.run(
              row.team_id,
              "listener",
              "gateway",
              "queued",
              row.id,
              "requeue: claim lease expired",
              input.now,
            )
            requeued.push({ ...row, state: "queued", claimed_by: null, updated_at: input.now })
            continue
          }
          expireClaimedListenerRunRequest.run(input.now, row.team_id, row.id)
          insertTeamMemoryAudit.run(
            row.team_id,
            "listener",
            "gateway",
            "expired",
            row.id,
            "claim_lease_expired",
            input.now,
          )
          notify(row.creator_uid, "listener_request_expired", {
            request_id: row.id,
            listener_id: row.listener_id,
            listener_name: row.listener_name,
            reason: "claim_lease_expired",
          })
          expired.push({ ...row, state: "expired", updated_at: input.now })
        }
      })()
      return { requeued, expired }
    },

    /**
     * Artifact provenance probes (filesystem spec v1 §5): an artifact
     * must name a memory entry or a session that exists for the team.
     * The entry probe accepts any status — the row is retained
     * server-side forever, so the link target either exists or it does
     * not, regardless of the entry's lifecycle state.
     */
    hasTeamMemoryEntry(teamId: string, entryId: string): boolean {
      return selectTeamMemoryById.get(teamId, entryId) != null
    },

    hasTeamMemorySession(teamId: string, sessionId: string): boolean {
      return selectTeamMemorySession.get(teamId, sessionId) != null
    },

    /** The team's last object policy run summary, if any. Stored as a
     * settings row beside the memory run's, so it survives restarts. */
    getObjectDreamingRun(teamId: string): TeamObjectDreamingRun | undefined {
      const row = getSetting.get(`dreaming-objects:${teamId}`) as { value: string } | undefined
      if (!row) return undefined
      try {
        const parsed = JSON.parse(row.value) as Partial<TeamObjectDreamingRun>
        if (typeof parsed.at !== "number") return undefined
        return {
          at: parsed.at,
          archived: parsed.archived ?? 0,
          flagged: parsed.flagged ?? 0,
          byKind: parsed.byKind ?? {},
        }
      } catch {
        return undefined
      }
    },

    /**
     * One policy sweep over every team's OBJECTS (filesystem spec v1
     * §7 — the Dreaming sweep partitioned by kind). Objects get only
     * the filesystem-wide rules; memory's evidence rules never touch
     * documents: the near-duplicate merge keys on normalized content
     * text and would merge distinct skills with similar bodies, and
     * weight decay / staleness are evidence concepts documents do not
     * carry. What applies here:
     *
     * 1. Archive superseded — a row another row supersedes never stays
     *    active. Archiving gives it a fresh seq, so the removal travels
     *    the pull feed as a tombstone and mirrors converge. (Push
     *    deliberately leaves superseded heads active; this closes the
     *    loop, exactly as the memory sweep archives superseded entries.)
     * 2. Chain integrity — an active row whose `supersedes` target is
     *    missing from the team is flagged, not silently trusted. Push
     *    rejects dangling pointers, so this fires only on corruption —
     *    which is exactly when a flag beats silence.
     *
     * Fully mechanical, nothing is ever deleted, and every action
     * writes an audit row under the actor `dreaming` tagged with the
     * object's own kind on the one shared trail. Decisions are computed
     * from a per-team snapshot, so a repeat sweep changes nothing
     * (idempotent). Each team's run summary is recorded for the
     * dashboard, with counts split by kind.
     */
    runTeamObjectPolicy(input: {
      now: number
    }): Array<{ teamId: string } & TeamObjectPolicyCounts> {
      const results: Array<{ teamId: string } & TeamObjectPolicyCounts> = []
      const teamIds = (allTeamIds.all() as { id: string }[]).map((row) => row.id)
      for (const teamId of teamIds) {
        const counts: TeamObjectPolicyCounts = { archived: 0, flagged: 0, byKind: {} }
        const bump = (kind: string, field: "archived" | "flagged") => {
          counts[field]++
          const per = counts.byKind[kind] ?? { archived: 0, flagged: 0 }
          per[field]++
          counts.byKind[kind] = per
        }
        db.transaction(() => {
          const rows = (allTeamObjectsForTeam.all(teamId) as TeamObjectRow[]).map((row) => ({
            ...row,
          }))
          const byId = new Map(rows.map((row) => [row.id, row]))
          const audit = (kind: string, action: string, entryId: string) =>
            insertTeamMemoryAudit.run(teamId, kind, "dreaming", action, entryId, null, input.now)
          const supersededIds = new Set(
            rows.map((row) => row.supersedes).filter((id): id is string => id !== null),
          )

          // 1. Archive superseded rows that are still active.
          for (const row of rows) {
            if (row.status !== "active" || !supersededIds.has(row.id)) continue
            row.status = "archived"
            row.updated_at = input.now
            row.seq = nextTeamObjectSeq(teamId)
            archiveTeamObject.run(row.updated_at, row.seq, teamId, row.id)
            audit(row.kind, "archive", row.id)
            bump(row.kind, "archived")
          }

          // 2. Flag active rows whose supersedes target is missing.
          for (const row of rows) {
            if (row.status !== "active" || !row.supersedes) continue
            if (byId.has(row.supersedes)) continue
            row.status = "flagged"
            row.updated_at = input.now
            row.seq = nextTeamObjectSeq(teamId)
            flagTeamObject.run(row.updated_at, row.seq, teamId, row.id)
            audit(row.kind, "flag", row.id)
            bump(row.kind, "flagged")
          }
        })()
        setSetting.run(
          `dreaming-objects:${teamId}`,
          JSON.stringify({ at: input.now, ...counts }),
        )
        results.push({ teamId, ...counts })
      }
      return results
    },

    /** Every team id — the policy sweep's work list. */
    teamIds(): string[] {
      return (allTeamIds.all() as { id: string }[]).map((row) => row.id)
    },

    /** Team-wide counts for the dashboard browser (spec v2 §11): totals
     * across all statuses, not just the list window. */
    teamMemoryCounts(teamId: string): TeamMemoryCounts {
      const byOutcome: Record<string, number> = {}
      for (const row of countTeamMemoryByOutcome.all(teamId) as { outcome: string; n: number }[]) {
        byOutcome[row.outcome] = row.n
      }
      const byStatus: Record<string, number> = {}
      for (const row of countTeamMemoryByStatus.all(teamId) as { status: string; n: number }[]) {
        byStatus[row.status] = row.n
      }
      return {
        total: (countTeamMemoryTotal.get(teamId) as { n: number }).n,
        byOutcome,
        byStatus,
      }
    },

    /** The team's last policy ("Dreaming") run summary, if any (spec v2
     * §11). Stored as a settings row so it survives restarts. */
    getDreamingRun(teamId: string): TeamMemoryDreamingRun | undefined {
      const row = getSetting.get(`dreaming:${teamId}`) as { value: string } | undefined
      if (!row) return undefined
      try {
        const parsed = JSON.parse(row.value) as Partial<TeamMemoryDreamingRun>
        if (typeof parsed.at !== "number") return undefined
        return {
          at: parsed.at,
          merged: parsed.merged ?? 0,
          flagged: parsed.flagged ?? 0,
          decayed: parsed.decayed ?? 0,
          archived: parsed.archived ?? 0,
        }
      } catch {
        return undefined
      }
    },

    /**
     * One policy sweep over every team (spec v2 §§9–10 — the hosted
     * Dreaming loop). Fully mechanical, no human gate; every action writes
     * an audit row under the actor `dreaming`, and nothing is ever deleted:
     *
     * 1. Merge near-duplicates — same team + container, same normalized
     *    content: the strongest entry absorbs the others' weight and
     *    verifiers (the push strengthen semantics), the absorbed entries
     *    are marked superseded_by it.
     * 2. Archive superseded entries — anything still active whose
     *    superseded_by is set.
     * 3. Staleness flags (§9, decision D4) — an active entry is flagged
     *    when a newer active entry in the same container verifies
     *    overlapping code at a different commit. Flag only: the row, its
     *    content, and its list visibility are untouched.
     * 4. Decay (§10) — active entries inactive for the whole retention
     *    window lose a factor of their weight, at most one step per
     *    window (tracked in metadata, so a repeat sweep is a no-op).
     *    Activity is last store/strengthen time; the store keeps no
     *    per-entry pull ledger in v1.
     * 5. Archive zero-weight entries (§10) inactive past the window.
     *
     * Decisions are computed from a per-team snapshot, so a second sweep
     * at the same instant changes nothing (idempotent). Each team's run
     * summary is recorded for the dashboard (§11).
     */
    runTeamMemoryPolicy(input: {
      now: number
      retentionMs: number
      decayFactor: number
    }): Array<{ teamId: string } & TeamMemoryPolicyCounts> {
      const results: Array<{ teamId: string } & TeamMemoryPolicyCounts> = []
      const teamIds = (allTeamIds.all() as { id: string }[]).map((row) => row.id)
      for (const teamId of teamIds) {
        const counts: TeamMemoryPolicyCounts = { merged: 0, flagged: 0, decayed: 0, archived: 0 }
        db.transaction(() => {
          const rows = (allTeamMemoryForTeam.all(teamId) as TeamMemoryRow[]).map((row) => ({
            ...row,
          }))
          const byId = new Map(rows.map((row) => [row.id, row]))
          const active = () => [...byId.values()].filter((row) => row.status === "active")
          const audit = (action: string, entryId: string) =>
            insertTeamMemoryAudit.run(teamId, "memory", "dreaming", action, entryId, null, input.now)

          // 1. Merge near-duplicates.
          const groups = new Map<string, TeamMemoryRow[]>()
          for (const row of active()) {
            const key = `${row.container}\n${normalizeMemoryContent(row.content)}`
            const group = groups.get(key)
            if (group) group.push(row)
            else groups.set(key, [row])
          }
          for (const group of groups.values()) {
            if (group.length < 2) continue
            group.sort((a, b) => b.weight - a.weight || a.created_at - b.created_at || a.seq - b.seq)
            const winner = group[0]
            if (!winner) continue
            for (const loser of group.slice(1)) {
              const metadata = JSON.parse(winner.metadata) as Record<string, unknown>
              const verifiers = new Set(
                Array.isArray(metadata.also_verified_by)
                  ? metadata.also_verified_by.filter((v): v is string => typeof v === "string")
                  : [],
              )
              if (loser.author_user_id && loser.author_user_id !== winner.author_user_id) {
                verifiers.add(loser.author_user_id)
              }
              metadata.also_verified_by = [...verifiers]
              winner.weight += loser.weight
              if (loser.created_at > winner.created_at && loser.commit_sha) {
                winner.commit_sha = loser.commit_sha
              }
              winner.metadata = JSON.stringify(metadata)
              winner.updated_at = input.now
              winner.seq = nextTeamMemorySeq(teamId)
              strengthenTeamMemory.run(
                winner.weight,
                winner.commit_sha,
                winner.metadata,
                winner.updated_at,
                winner.seq,
                teamId,
                winner.id,
              )
              audit("strengthen", winner.id)
              loser.superseded_by = winner.id
              loser.updated_at = input.now
              loser.seq = nextTeamMemorySeq(teamId)
              supersedeTeamMemory.run(winner.id, loser.updated_at, loser.seq, teamId, loser.id)
              audit("supersede", loser.id)
              counts.merged++
            }
          }

          // 2. Archive superseded entries.
          for (const row of active()) {
            if (!row.superseded_by) continue
            row.status = "archived"
            row.updated_at = input.now
            row.seq = nextTeamMemorySeq(teamId)
            archiveTeamMemory.run(row.updated_at, row.seq, teamId, row.id)
            audit("archive", row.id)
            counts.archived++
          }

          // 3. Staleness flags — decided from the post-merge active set,
          // before any flag is applied, so the outcome cannot depend on
          // iteration order.
          const actives = active()
          const refsOf = (row: TeamMemoryRow): string[] => {
            try {
              const parsed = JSON.parse(row.code_refs) as unknown
              return Array.isArray(parsed)
                ? parsed.filter((ref): ref is string => typeof ref === "string")
                : []
            } catch {
              return []
            }
          }
          const stale = actives.filter(
            (entry) =>
              entry.commit_sha &&
              actives.some(
                (newer) =>
                  newer.id !== entry.id &&
                  newer.container === entry.container &&
                  newer.commit_sha &&
                  newer.commit_sha !== entry.commit_sha &&
                  newer.created_at > entry.created_at &&
                  refsOf(newer).some((ref) => refsOf(entry).includes(ref)),
              ),
          )
          for (const row of stale) {
            row.status = "flagged"
            row.updated_at = input.now
            row.seq = nextTeamMemorySeq(teamId)
            flagTeamMemory.run(row.updated_at, row.seq, teamId, row.id)
            audit("flag", row.id)
            counts.flagged++
          }

          // 4. Decay weights of entries inactive for a full window.
          for (const row of active()) {
            const metadata = JSON.parse(row.metadata) as Record<string, unknown>
            const lastDecay =
              typeof metadata.dreaming_decayed_at === "number" ? metadata.dreaming_decayed_at : 0
            if (input.now - Math.max(row.updated_at, lastDecay) < input.retentionMs) continue
            const decayed = Math.round(row.weight * input.decayFactor * 1000) / 1000
            if (decayed === row.weight) continue
            metadata.dreaming_decayed_at = input.now
            row.weight = decayed
            row.metadata = JSON.stringify(metadata)
            row.seq = nextTeamMemorySeq(teamId)
            decayTeamMemory.run(row.weight, row.metadata, row.seq, teamId, row.id)
            audit("decay", row.id)
            counts.decayed++
          }

          // 5. Archive zero-weight entries past the window.
          for (const row of active()) {
            if (row.weight > 0) continue
            if (input.now - row.updated_at < input.retentionMs) continue
            row.status = "archived"
            row.updated_at = input.now
            row.seq = nextTeamMemorySeq(teamId)
            archiveTeamMemory.run(row.updated_at, row.seq, teamId, row.id)
            audit("archive", row.id)
            counts.archived++
          }
        })()
        setSetting.run(
          `dreaming:${teamId}`,
          JSON.stringify({ at: input.now, ...counts }),
        )
        results.push({ teamId, ...counts })
      }
      return results
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

/** Content identity for the policy job's duplicate detection (spec v2
 * §10): case- and whitespace-insensitive, so a re-captured lesson with
 * cosmetic differences still reads as the same lesson. */
function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase()
}

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
