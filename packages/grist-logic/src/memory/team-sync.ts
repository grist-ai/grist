import fs from "node:fs"
import path from "node:path"
import { gatewayAuthHeaders, loadInviteConfig, type InviteConfig } from "../invite-config.js"
import { gristLog, gristWarn } from "../debug.js"
import { findSecretKind } from "./secrets-scan.js"
import type { MemoryHit, MemoryRecord } from "./types.js"
import { decayScore } from "./verified.js"

/**
 * Team memory sync — the harness side of spec v2 §§6–8 (slice S2).
 *
 * Local-first, always: capture and recall work fully offline against the
 * local store; sync is a background consequence of capture, never a gate
 * on a session. A repo participates ONLY after explicit per-repo opt-in
 * (decision D2): the opt-in flag lives in the repo's sync state file, and
 * when it is off this module makes zero network calls and writes nothing.
 *
 * State (journal + mirror) lives next to the local store at
 * `<cwd>/.grist/team-memory.json` (spec §6 names the mirror file; the
 * journal rides in the same file so the two can never disagree):
 * - `cursor`    — last pulled per-team seq; pull is incremental on it
 * - `mirror`    — team entries pulled from the gateway, provenance intact
 * - `pending`   — locally distilled records queued for push (offline-safe)
 * - `pushed`    — ids the gateway accepted (stored | strengthened)
 * - `rejected`  — ids the gateway (or the capture-time scan) refused;
 *                 terminal — never retried blindly
 * - `revoked`   — the gateway said this account has no team (spec §7):
 *                 mirror wiped, sync paused until re-enabled
 * - `objects`   — the team-filesystem journal (filesystem spec v1 §6,
 *                 slice S-FS2, logic in team-objects.ts): a second
 *                 stream with its own cursor; bodies are materialized
 *                 as files, only the manifest rides here
 */

/** Decision D5: total injected memory context budget, local + team. */
export const TEAM_RECALL_TOKEN_BUDGET = 4000

/** Gateway push batch cap (spec §6). */
const PUSH_BATCH = 50

/** Cross-container team entries rank below same-repo knowledge (spec §8). */
const CROSS_CONTAINER_FACTOR = 0.5

export type TeamMirrorEntry = MemoryRecord & {
  authorUserId: string
  commitSha?: string
  codeRefs: string[]
  seq: number
}

/** Object kinds in the team filesystem (filesystem spec v1 §3). Memory never lands here. */
export type TeamObjectKind = "skill" | "agent_definition"

/** One object version as it travels the push/pull wire (filesystem spec v1 §6). */
export type TeamObjectWire = {
  id: string
  kind: TeamObjectKind
  container: string
  name: string
  body: string
  metadata: Record<string, unknown>
  supersedes?: string | null
}

/**
 * The materialized mirror's index entry for one chain (filesystem spec
 * v1 §6): the state file stores only this manifest — never object
 * bodies. Bodies live as files under the materialization roots
 * (`.grist/team/…`, `.grist/team-global/…`); `path` is repo-relative.
 */
export type TeamObjectManifestEntry = {
  kind: TeamObjectKind
  container: string
  name: string
  /** Current head object id. */
  id: string
  seq: number
  /** sha256 hex of the materialized file's content. */
  hash: string
  path: string
  authorUserId: string
}

/**
 * The objects section of the sync journal (filesystem spec v1 §6): a
 * second stream riding the same state file and the same opt-in switch.
 * Its cursor lives in the objects' own per-team seq space — it must
 * never share or move the memory `cursor` above, nor be moved by it.
 * Keys for `pushedHeads` and `manifest` are chain keys
 * (`<kind>:<container>:<name>`, see team-objects.ts).
 */
export type TeamObjectJournal = {
  cursor: number
  pending: TeamObjectWire[]
  pushed: Record<string, { at: number }>
  rejected: Record<string, { reason: string; at: number }>
  /** Chain key → object id of the last head this repo pushed (supersedes wiring for edits). */
  pushedHeads: Record<string, string>
  /** Chain key → what is currently materialized on disk. */
  manifest: Record<string, TeamObjectManifestEntry>
  lastPushAt?: number
  lastPullAt?: number
  lastError?: string
}

export function defaultTeamObjectJournal(): TeamObjectJournal {
  return { cursor: 0, pending: [], pushed: {}, rejected: {}, pushedHeads: {}, manifest: {} }
}

export type TeamSyncState = {
  version: 1
  enabled: boolean
  revoked: boolean
  cursor: number
  mirror: TeamMirrorEntry[]
  pending: MemoryRecord[]
  pushed: Record<string, { signature?: string; at: number }>
  rejected: Record<string, { reason: string; at: number }>
  objects: TeamObjectJournal
  lastPushAt?: number
  lastPullAt?: number
  lastError?: string
}

export type TeamSyncDeps = {
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, text: string) => Promise<void>
  mkdir?: (path: string) => Promise<void>
  fetch?: typeof fetch
  loadConfig?: () => InviteConfig | undefined
  now?: () => number
}

export function teamSyncPath(cwd: string): string {
  return process.env.GRIST_TEAM_MEMORY_PATH ?? path.join(cwd, ".grist", "team-memory.json")
}

function defaultState(): TeamSyncState {
  return {
    version: 1,
    enabled: false,
    revoked: false,
    cursor: 0,
    mirror: [],
    pending: [],
    pushed: {},
    rejected: {},
    objects: defaultTeamObjectJournal(),
  }
}

function normalizeObjectJournal(raw: unknown): TeamObjectJournal {
  if (!raw || typeof raw !== "object") return defaultTeamObjectJournal()
  const journal = raw as Partial<TeamObjectJournal>
  return {
    cursor: typeof journal.cursor === "number" && Number.isFinite(journal.cursor) ? journal.cursor : 0,
    pending: Array.isArray(journal.pending) ? journal.pending : [],
    pushed: journal.pushed && typeof journal.pushed === "object" ? journal.pushed : {},
    rejected: journal.rejected && typeof journal.rejected === "object" ? journal.rejected : {},
    pushedHeads: journal.pushedHeads && typeof journal.pushedHeads === "object" ? journal.pushedHeads : {},
    manifest: journal.manifest && typeof journal.manifest === "object" ? journal.manifest : {},
    lastPushAt: typeof journal.lastPushAt === "number" ? journal.lastPushAt : undefined,
    lastPullAt: typeof journal.lastPullAt === "number" ? journal.lastPullAt : undefined,
    lastError: typeof journal.lastError === "string" ? journal.lastError : undefined,
  }
}

function normalizeState(parsed: unknown): TeamSyncState {
  if (!parsed || typeof parsed !== "object") return defaultState()
  const raw = parsed as Partial<TeamSyncState>
  return {
    version: 1,
    enabled: raw.enabled === true,
    revoked: raw.revoked === true,
    cursor: typeof raw.cursor === "number" && Number.isFinite(raw.cursor) ? raw.cursor : 0,
    mirror: Array.isArray(raw.mirror) ? raw.mirror : [],
    pending: Array.isArray(raw.pending) ? raw.pending : [],
    pushed: raw.pushed && typeof raw.pushed === "object" ? raw.pushed : {},
    rejected: raw.rejected && typeof raw.rejected === "object" ? raw.rejected : {},
    objects: normalizeObjectJournal(raw.objects),
    lastPushAt: typeof raw.lastPushAt === "number" ? raw.lastPushAt : undefined,
    lastPullAt: typeof raw.lastPullAt === "number" ? raw.lastPullAt : undefined,
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
  }
}

const defaultReadFile = async (file: string) => {
  const fsp = await import("node:fs/promises")
  return fsp.readFile(file, "utf-8")
}
const defaultWriteFile = async (file: string, text: string) => {
  const fsp = await import("node:fs/promises")
  await fsp.writeFile(file, text, "utf-8")
}
const defaultMkdir = async (dir: string) => {
  const fsp = await import("node:fs/promises")
  await fsp.mkdir(dir, { recursive: true })
}

/** Load the repo's sync state. A missing/corrupt file reads as the default (never opted in). */
export async function loadTeamSyncState(cwd: string, deps?: TeamSyncDeps): Promise<TeamSyncState> {
  try {
    const raw = await (deps?.readFile ?? defaultReadFile)(teamSyncPath(cwd))
    return normalizeState(JSON.parse(raw) as unknown)
  } catch {
    return defaultState()
  }
}

/** Synchronous twin for status surfaces (doctor) that cannot await. */
export function readTeamSyncStateSync(cwd: string): TeamSyncState {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(teamSyncPath(cwd), "utf-8")) as unknown)
  } catch {
    return defaultState()
  }
}

export async function saveTeamSyncState(cwd: string, state: TeamSyncState, deps?: TeamSyncDeps): Promise<void> {
  const file = teamSyncPath(cwd)
  await (deps?.mkdir ?? defaultMkdir)(path.dirname(file))
  await (deps?.writeFile ?? defaultWriteFile)(file, JSON.stringify(state, null, 2))
}

/** Flip the per-repo opt-in (D2). Enabling also clears a stale revoked pause. */
export async function setTeamMemoryEnabled(
  cwd: string,
  enabled: boolean,
  deps?: TeamSyncDeps,
): Promise<TeamSyncState> {
  const state = await loadTeamSyncState(cwd, deps)
  state.enabled = enabled
  if (enabled) state.revoked = false
  await saveTeamSyncState(cwd, state, deps)
  return state
}

export type QueueResult = "queued" | "disabled" | "duplicate" | "rejected"

/**
 * Queue a locally distilled record for push. Called at the same point
 * local capture persists (the distillers' `remember`). The capture-time
 * secrets scan (§7) runs here: a hit is recorded as a terminal rejection
 * and the entry never leaves the machine.
 */
export async function queueTeamMemoryPush(
  cwd: string,
  record: MemoryRecord,
  deps?: TeamSyncDeps,
): Promise<QueueResult> {
  const state = await loadTeamSyncState(cwd, deps)
  if (!state.enabled) return "disabled"
  if (state.pushed[record.id] || state.rejected[record.id]) return "duplicate"
  if (state.pending.some((entry) => entry.id === record.id)) return "duplicate"
  const secret = findSecretKind(record.content)
  if (secret) {
    state.rejected[record.id] = { reason: "secret_detected", at: (deps?.now ?? Date.now)() }
    await saveTeamSyncState(cwd, state, deps)
    gristWarn(`[grist:team-memory] entry ${record.id} held locally: credential-shaped content (${secret})`)
    return "rejected"
  }
  state.pending.push(record)
  await saveTeamSyncState(cwd, state, deps)
  return "queued"
}

type PushResultRow = { id: string | null; result: string; reason?: string }

export type PushSummary = {
  attempted: number
  stored: number
  strengthened: number
  rejected: number
  pending: number
  error?: string
}

/**
 * Push the pending queue to the gateway, in spec §6 batches. Best-effort:
 * any transport/HTTP failure leaves the un-acked entries pending for the
 * next session and records `lastError` — sync never fails a session.
 */
export async function flushTeamMemoryPushes(cwd: string, deps?: TeamSyncDeps): Promise<PushSummary> {
  const state = await loadTeamSyncState(cwd, deps)
  const done = (error?: string): PushSummary => ({
    attempted: 0,
    stored: 0,
    strengthened: 0,
    rejected: 0,
    pending: state.pending.length,
    ...(error ? { error } : {}),
  })
  if (!state.enabled || state.revoked || state.pending.length === 0) return done()
  const config = (deps?.loadConfig ?? loadInviteConfig)()
  if (!config) return done("not signed in")

  const summary = done()
  const doFetch = deps?.fetch ?? fetch
  while (state.pending.length > 0) {
    const batch = state.pending.slice(0, PUSH_BATCH)
    let response: Response
    try {
      response = await doFetch(`${config.gatewayUrl}/v1/team-memory/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...gatewayAuthHeaders(config) },
        body: JSON.stringify({ entries: batch }),
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      summary.error = error instanceof Error ? error.message : String(error)
      break
    }
    if (response.status === 409) {
      // Not in a team (anymore): same revocation semantics as pull (§7).
      await applyRevoked(cwd, state, deps)
      summary.error = "not in a team"
      break
    }
    if (!response.ok) {
      summary.error = `gateway push failed: HTTP ${response.status}`
      break
    }
    const body = (await response.json().catch(() => undefined)) as { results?: PushResultRow[] } | undefined
    const results = new Map((body?.results ?? []).map((row) => [row.id, row]))
    const decided = new Set<string>()
    for (const record of batch) {
      const row = results.get(record.id)
      if (!row) continue
      decided.add(record.id)
      summary.attempted++
      if (row.result === "stored" || row.result === "strengthened") {
        state.pushed[record.id] = { signature: record.metadata?.signature, at: (deps?.now ?? Date.now)() }
        if (row.result === "stored") summary.stored++
        else summary.strengthened++
      } else {
        state.rejected[record.id] = { reason: row.reason ?? "rejected", at: (deps?.now ?? Date.now)() }
        summary.rejected++
      }
    }
    state.pending = state.pending.filter((record) => !decided.has(record.id))
    // The gateway acked nothing in this batch: don't spin — the un-acked
    // entries stay pending and retry on the next sync.
    if (decided.size === 0) break
  }
  summary.pending = state.pending.length
  if (!summary.error) {
    state.lastPushAt = (deps?.now ?? Date.now)()
    delete state.lastError
  } else {
    state.lastError = summary.error
  }
  await saveTeamSyncState(cwd, state, deps)
  if (summary.attempted > 0) {
    gristLog(
      `[grist:team-memory] push stored=${summary.stored} strengthened=${summary.strengthened} rejected=${summary.rejected} pending=${summary.pending}`,
    )
  }
  return summary
}

export type PullSummary = {
  pulled: number
  tombstoned: number
  revoked: boolean
  cursor: number
  error?: string
}

type PulledWireEntry = {
  id: string
  content: string
  container: string
  outcome: MemoryRecord["outcome"]
  weight: number
  createdAt: number
  sessionID?: string
  metadata?: Record<string, string>
  author_user_id: string
  commit_sha?: string | null
  code_refs?: string[]
  status?: string
  seq: number
  superseded_by?: string | null
}

async function applyRevoked(cwd: string, state: TeamSyncState, deps?: TeamSyncDeps): Promise<void> {
  state.mirror = []
  state.cursor = 0
  state.revoked = true
  await saveTeamSyncState(cwd, state, deps)
}

/**
 * Pull team entries since the journal cursor into the local mirror and
 * apply tombstones. The cursor advances only on success. A `revoked`
 * answer (account has no team — spec §7) wipes the mirror and pauses
 * sync until the repo is re-enabled.
 */
export async function pullTeamMemory(cwd: string, deps?: TeamSyncDeps): Promise<PullSummary> {
  const state = await loadTeamSyncState(cwd, deps)
  const base: PullSummary = { pulled: 0, tombstoned: 0, revoked: state.revoked, cursor: state.cursor }
  if (!state.enabled || state.revoked) return base
  const config = (deps?.loadConfig ?? loadInviteConfig)()
  if (!config) return { ...base, error: "not signed in" }

  let response: Response
  try {
    response = await (deps?.fetch ?? fetch)(`${config.gatewayUrl}/v1/team-memory/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...gatewayAuthHeaders(config) },
      body: JSON.stringify({ since_seq: state.cursor }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) return { ...base, error: `gateway pull failed: HTTP ${response.status}` }
  const body = (await response.json().catch(() => undefined)) as
    | { revoked?: boolean; entries?: PulledWireEntry[]; tombstones?: string[]; next_seq?: number }
    | undefined
  if (!body) return { ...base, error: "gateway pull returned an unreadable body" }
  if (body.revoked) {
    await applyRevoked(cwd, state, deps)
    return { pulled: 0, tombstoned: 0, revoked: true, cursor: 0 }
  }

  const byId = new Map(state.mirror.map((entry) => [entry.id, entry]))
  let pulled = 0
  for (const wire of body.entries ?? []) {
    if (!wire || typeof wire.id !== "string" || typeof wire.content !== "string") continue
    if (wire.status && wire.status !== "active") {
      byId.delete(wire.id)
      continue
    }
    byId.set(wire.id, {
      id: wire.id,
      content: wire.content,
      container: wire.container,
      outcome: wire.outcome,
      weight: typeof wire.weight === "number" ? wire.weight : 0.75,
      createdAt: typeof wire.createdAt === "number" ? wire.createdAt : 0,
      ...(wire.sessionID ? { sessionID: wire.sessionID } : {}),
      ...(wire.metadata ? { metadata: wire.metadata } : {}),
      authorUserId: typeof wire.author_user_id === "string" ? wire.author_user_id : "unknown",
      ...(typeof wire.commit_sha === "string" && wire.commit_sha ? { commitSha: wire.commit_sha } : {}),
      codeRefs: Array.isArray(wire.code_refs) ? wire.code_refs : [],
      seq: typeof wire.seq === "number" ? wire.seq : 0,
    })
    pulled++
  }
  let tombstoned = 0
  for (const id of body.tombstones ?? []) {
    if (byId.delete(id)) tombstoned++
  }
  state.mirror = [...byId.values()]
  if (typeof body.next_seq === "number" && Number.isFinite(body.next_seq)) {
    state.cursor = body.next_seq
  }
  state.lastPullAt = (deps?.now ?? Date.now)()
  delete state.lastError
  await saveTeamSyncState(cwd, state, deps)
  if (pulled > 0 || tombstoned > 0) {
    gristLog(`[grist:team-memory] pull entries=${pulled} tombstones=${tombstoned} cursor=${state.cursor}`)
  }
  return { pulled, tombstoned, revoked: false, cursor: state.cursor }
}

/** Session-start sync: flush anything queued offline, then pull fresh team entries. */
export async function syncTeamMemory(
  cwd: string,
  deps?: TeamSyncDeps,
): Promise<{ push: PushSummary; pull: PullSummary }> {
  const push = await flushTeamMemoryPushes(cwd, deps)
  const pull = await pullTeamMemory(cwd, deps)
  return { push, pull }
}

/** Lexical relevance, mirroring the file store's recall scoring. */
function lexicalScore(query: string, content: string): number {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const blob = content.toLowerCase()
  if (blob.includes(needle)) return 1
  return needle.split(/\s+/).filter((word) => word && blob.includes(word)).length * 0.25
}

/**
 * Recall from the team mirror. Same-container entries compete at parity
 * with local recall (weight × recency × lexical); cross-container team
 * entries are demoted (spec §8 scope discipline). Every hit carries its
 * author's public user ID as provenance.
 */
export function recallTeamMemory(
  state: TeamSyncState,
  input: { query: string; container: string; limit?: number; now?: number },
): MemoryHit[] {
  const now = input.now ?? Date.now()
  const scored = state.mirror
    .map((entry) => {
      const sameContainer = entry.container === input.container
      const score =
        lexicalScore(input.query, entry.content) *
        decayScore(entry, now) *
        (sameContainer ? 1 : CROSS_CONTAINER_FACTOR)
      return { entry, score }
    })
    .filter((row) => row.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 12)
  return scored.map((row) => ({
    content: row.entry.content,
    score: row.score,
    id: row.entry.id,
    outcome: row.entry.outcome,
    team: { authorUserId: row.entry.authorUserId },
  }))
}

/** Rough token estimate for budget accounting (~4 chars/token). */
export function estimateMemoryTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Merge local + team hits into one ranked injection under the shared
 * budget (D5). Ranking is by score across both sources — the budget is
 * the only cap (plus a hard count ceiling so a flood of tiny hits can't
 * crowd out the prompt). At least the top hit is always kept, so recall
 * never silently empties on one oversized entry.
 */
export function mergeRecallHits(input: {
  local: MemoryHit[]
  team: MemoryHit[]
  budgetTokens?: number
  maxHits?: number
}): MemoryHit[] {
  const budget = input.budgetTokens ?? TEAM_RECALL_TOKEN_BUDGET
  const maxHits = input.maxHits ?? 10
  const ranked = [...input.local, ...input.team].toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const merged: MemoryHit[] = []
  let used = 0
  for (const hit of ranked) {
    if (merged.length >= maxHits) break
    const cost = estimateMemoryTokens(hit.content) + 16
    if (merged.length > 0 && used + cost > budget) continue
    merged.push(hit)
    used += cost
  }
  return merged
}

export type TeamSyncStatus = {
  enabled: boolean
  revoked: boolean
  mirrorCount: number
  pendingCount: number
  pushedCount: number
  rejectedCount: number
  cursor: number
  lastPushAt?: number
  lastPullAt?: number
  lastError?: string
  path: string
}

export function summarizeTeamSyncState(state: TeamSyncState, cwd: string): TeamSyncStatus {
  return {
    enabled: state.enabled,
    revoked: state.revoked,
    mirrorCount: state.mirror.length,
    pendingCount: state.pending.length,
    pushedCount: Object.keys(state.pushed).length,
    rejectedCount: Object.keys(state.rejected).length,
    cursor: state.cursor,
    ...(state.lastPushAt ? { lastPushAt: state.lastPushAt } : {}),
    ...(state.lastPullAt ? { lastPullAt: state.lastPullAt } : {}),
    ...(state.lastError ? { lastError: state.lastError } : {}),
    path: teamSyncPath(cwd),
  }
}
