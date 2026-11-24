import { createHash, randomBytes } from "node:crypto"
import path from "node:path"
import { gatewayAuthHeaders, loadInviteConfig } from "../invite-config.js"
import { gristLog, gristWarn } from "../debug.js"
import { PUBLIC_RUNGS } from "../rung.js"
import { findSecretKind } from "./secrets-scan.js"
import {
  loadTeamSyncState,
  saveTeamSyncState,
  type QueueResult,
  type TeamObjectJournal,
  type TeamObjectKind,
  type TeamObjectManifestEntry,
  type TeamObjectWire,
  type TeamSyncDeps,
  type TeamSyncState,
} from "./team-sync.js"

/**
 * Team object sync — the harness side of the agent filesystem
 * (filesystem spec v1 §6, slice S-FS2). Objects (skills, agent
 * definitions) ride the same protocol as team memory but as a SECOND
 * stream: their own gateway seq space, their own journal cursor, the
 * same per-repo opt-in switch and the same best-effort posture — sync
 * never blocks or fails a session, and a repo that never opted in makes
 * zero object calls.
 *
 * The mirror asymmetry (§6) is the one real difference from memory:
 * object bodies are NOT inlined into the journal. Pulled heads are
 * materialized as files the harness's loaders already understand —
 * skills as `<name>/SKILL.md`, agent definitions as `<name>.md` in the
 * harness's markdown definition format — and the journal keeps only a
 * manifest (chain key → head id, seq, content hash, path).
 *
 * Containers: a repo's own objects materialize under `.grist/team/`;
 * team-global objects (the reserved container below) under
 * `.grist/team-global/`, a lower-precedence root the loaders scan
 * first, so a repo's own copy shadows the team-global one exactly as a
 * repo-local definition shadows a team one (D-FS6). Objects from other
 * repos' containers are never pulled into this repo.
 */

/**
 * The reserved container for team-global objects (filesystem spec v1
 * §4). The spec reserves a container without naming it; S-FS1 treated
 * container as opaque, so the name is fixed here, where it is first
 * consumed. The colon makes a collision with a real repo directory
 * basename (the per-repo container) a practical impossibility.
 */
export const TEAM_GLOBAL_CONTAINER = "team:global"

/** Gateway push batch cap and per-object body cap (filesystem spec v1 §§5–6). */
const PUSH_BATCH = 50
const MAX_BODY_BYTES = 32 * 1024
/** Slug rule, mirrored from the gateway's admission (TEAM_OBJECT_NAME). */
const OBJECT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type TeamObjectDeps = TeamSyncDeps & {
  removeFile?: (path: string) => Promise<void>
  removeDir?: (path: string) => Promise<void>
  /** The repo's own container; defaults to the directory basename, as memory's does. */
  container?: string
}

const defaultRemoveFile = async (file: string) => {
  const fsp = await import("node:fs/promises")
  await fsp.rm(file, { force: true })
}
const defaultRemoveDir = async (dir: string) => {
  const fsp = await import("node:fs/promises")
  await fsp.rm(dir, { recursive: true, force: true })
}

/** The repo's own container: the directory basename, mirroring the memory sink. */
export function containerForDirectory(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? "default"
}

/** Journal key for one version chain: (kind, container, name) is the chain's identity. */
export function teamObjectChainKey(kind: TeamObjectKind, container: string, name: string): string {
  return `${kind}:${container}:${name}`
}

/** Root the repo's own team objects materialize under (filesystem spec v1 §6). */
export function teamObjectsRoot(cwd: string): string {
  return path.join(cwd, ".grist", "team")
}

/** Root team-global objects materialize under — the lower-precedence sibling of `.grist/team`. */
export function teamGlobalObjectsRoot(cwd: string): string {
  return path.join(cwd, ".grist", "team-global")
}

function rootForContainer(cwd: string, container: string, ownContainer: string): string {
  return container === TEAM_GLOBAL_CONTAINER ? teamGlobalObjectsRoot(cwd) : teamObjectsRoot(cwd)
}

/**
 * Where one chain's head materializes. Skills are directories holding a
 * SKILL.md (the shape the skill loader scans); agent definitions are
 * single markdown files in the harness's definition format.
 */
export function teamObjectPath(
  cwd: string,
  ownContainer: string,
  object: { kind: TeamObjectKind; container: string; name: string },
): string {
  const root = rootForContainer(cwd, object.container, ownContainer)
  return object.kind === "skill"
    ? path.join(root, "skill", object.name, "SKILL.md")
    : path.join(root, "agent_definition", `${object.name}.md`)
}

export function hashTeamObjectContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

export function newTeamObjectId(): string {
  return `obj_${randomBytes(12).toString("hex")}`
}

/**
 * The flat `key: value` fields of a leading `---` frontmatter block —
 * the same deliberately shallow scan the gateway's admission runs, so
 * local validation and gateway validation read a file the same way.
 */
export function parseObjectFrontmatter(content: string): {
  present: boolean
  closed: boolean
  fields: Record<string, string>
  /** The content after the closing fence (the whole input when no block is present). */
  rest: string
} {
  if (!content.startsWith("---")) return { present: false, closed: true, fields: {}, rest: content }
  const lines = content.split("\n")
  if (lines[0]?.trim() !== "---") return { present: false, closed: true, fields: {}, rest: content }
  const fields: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim()
    if (line === "---" || line === "...") {
      return { present: true, closed: true, fields, rest: lines.slice(i + 1).join("\n") }
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match?.[1] && match[2] !== undefined) {
      fields[match[1]] = match[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")
    }
  }
  return { present: true, closed: false, fields, rest: content }
}

/** A YAML string list in flow (`[a, b]`) or block (`- a` lines) form, read shallowly. */
function parseStringList(raw: string | undefined, blockLines: string[]): string[] | undefined {
  if (raw !== undefined && raw.trim()) {
    const trimmed = raw.trim()
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"))
        .filter((item) => item.length > 0)
    }
    return [trimmed.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")]
  }
  if (blockLines.length === 0) return undefined
  return blockLines
    .map((line) => line.trim().replace(/^-\s*/, "").replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"))
    .filter((item) => item.length > 0)
}

/** Frontmatter fields plus any block-list lines that follow a `key:` line (for `tools:`). */
function parseDefinitionFrontmatter(content: string): {
  present: boolean
  closed: boolean
  fields: Record<string, string>
  lists: Record<string, string[]>
  rest: string
} {
  const base = parseObjectFrontmatter(content)
  const lists: Record<string, string[]> = {}
  if (base.present && base.closed) {
    const lines = content.split("\n")
    let current: string | undefined
    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i] ?? ""
      const line = raw.trim()
      if (line === "---" || line === "...") break
      if (/^-\s+/.test(line) && current) {
        ;(lists[current] ??= []).push(line)
        continue
      }
      const match = /^([A-Za-z0-9_-]+):/.exec(line)
      current = match?.[1]
    }
  }
  return { ...base, lists }
}

/**
 * Local admission, mirroring the gateway's boundary checks reason for
 * reason (filesystem spec v1 §5): a publish that would be rejected is
 * refused here with the gateway's own reason, before anything is
 * queued. Verified-kinds-only does NOT apply — that rule is memory's
 * (D-FS4); documents are admitted on schema validity + secrets scan.
 */
export function validateTeamObject(object: TeamObjectWire): string | undefined {
  if (object.kind !== "skill" && object.kind !== "agent_definition") return "invalid_kind"
  if (typeof object.container !== "string" || object.container.length === 0 || object.container.length > 256) {
    return "invalid_entry"
  }
  if (!OBJECT_NAME.test(object.name)) return "invalid_name"
  if (typeof object.body !== "string" || object.body.length === 0) return "invalid_entry"
  if (new TextEncoder().encode(object.body).length > MAX_BODY_BYTES) return "oversize"
  if (!object.metadata || typeof object.metadata !== "object" || Array.isArray(object.metadata)) {
    return "invalid_metadata"
  }
  if (findSecretKind(object.body) || findSecretKind(JSON.stringify(object.metadata))) {
    return "secret_detected"
  }
  if (object.kind === "skill") {
    const frontmatter = parseObjectFrontmatter(object.body)
    if (frontmatter.present && !frontmatter.closed) return "invalid_schema"
    if (frontmatter.fields.name && frontmatter.fields.name !== object.name) return "invalid_schema"
    const declared = object.metadata.description
    const description =
      typeof declared === "string" && declared.trim() ? declared : frontmatter.fields.description
    if (!description || description.length > 1024) return "invalid_schema"
    return undefined
  }
  const tools = object.metadata.tools
  if (tools !== undefined) {
    if (!Array.isArray(tools)) return "invalid_schema"
    if (tools.some((tool) => typeof tool !== "string" || tool.length === 0)) return "invalid_schema"
  }
  const ceiling = object.metadata.rung_ceiling
  if (ceiling !== undefined) {
    if (typeof ceiling !== "string" || !(PUBLIC_RUNGS as readonly string[]).includes(ceiling)) {
      return "invalid_schema"
    }
  }
  return undefined
}

/**
 * Build a skill object from a local SKILL.md-shaped file. The body is
 * the file verbatim (frontmatter included — the gateway reads the
 * description from either place); `description` covers files whose
 * frontmatter has none, riding in metadata instead.
 */
export function buildSkillObject(input: {
  content: string
  fallbackName: string
  container: string
  id: string
  supersedes?: string | null
  description?: string
}): TeamObjectWire {
  const frontmatter = parseObjectFrontmatter(input.content)
  const metadata: Record<string, unknown> = {}
  if (input.description && !frontmatter.fields.description) metadata.description = input.description
  return {
    id: input.id,
    kind: "skill",
    container: input.container,
    name: frontmatter.fields.name ?? input.fallbackName,
    body: input.content,
    metadata,
    supersedes: input.supersedes ?? null,
  }
}

/**
 * Build an agent-definition object from a local definition file: the
 * body is the system prompt (frontmatter stripped), and the config the
 * gateway constrains — description, tools, rung ceiling, mode — rides
 * in metadata, read from the file's frontmatter.
 */
export function buildAgentDefinitionObject(input: {
  content: string
  fallbackName: string
  container: string
  id: string
  supersedes?: string | null
}): TeamObjectWire {
  const frontmatter = parseDefinitionFrontmatter(input.content)
  const metadata: Record<string, unknown> = {}
  if (frontmatter.fields.description) metadata.description = frontmatter.fields.description
  const tools = parseStringList(frontmatter.fields.tools, frontmatter.lists.tools ?? [])
  if (tools !== undefined) metadata.tools = tools
  const ceiling = frontmatter.fields.rung_ceiling ?? frontmatter.fields["rung-ceiling"]
  if (ceiling) metadata.rung_ceiling = ceiling
  if (frontmatter.fields.mode) metadata.mode = frontmatter.fields.mode
  return {
    id: input.id,
    kind: "agent_definition",
    container: input.container,
    name: input.fallbackName,
    body: (frontmatter.present ? frontmatter.rest : input.content).trim(),
    metadata,
    supersedes: input.supersedes ?? null,
  }
}

const AGENT_MODES = ["subagent", "primary", "all"] as const

function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

/**
 * Render a pulled skill head as its materialized file. A body that
 * already carries frontmatter is written verbatim; otherwise the
 * frontmatter is synthesized from the object's name and the metadata
 * description the gateway required to exist in one of the two places.
 */
export function renderSkillFile(object: { name: string; body: string; metadata: Record<string, unknown> }): string {
  const frontmatter = parseObjectFrontmatter(object.body)
  if (frontmatter.present) return object.body
  const description = typeof object.metadata.description === "string" ? object.metadata.description : ""
  return ["---", `name: ${yamlScalar(object.name)}`, `description: ${yamlScalar(description)}`, "---", object.body].join(
    "\n",
  )
}

/**
 * Render a pulled agent definition in the harness's definition format:
 * frontmatter carrying the def's config (description, mode, tool
 * surface, rung ceiling) over the system-prompt body. Mode defaults to
 * `subagent` — a team definition is a reusable specialist; making it a
 * primary agent is a local, deliberate choice.
 */
export function renderAgentDefinitionFile(object: {
  name: string
  body: string
  metadata: Record<string, unknown>
}): string {
  const lines = ["---"]
  if (typeof object.metadata.description === "string" && object.metadata.description) {
    lines.push(`description: ${yamlScalar(object.metadata.description)}`)
  }
  const mode =
    typeof object.metadata.mode === "string" && (AGENT_MODES as readonly string[]).includes(object.metadata.mode)
      ? object.metadata.mode
      : "subagent"
  lines.push(`mode: ${mode}`)
  if (Array.isArray(object.metadata.tools)) {
    const tools = object.metadata.tools.filter((tool): tool is string => typeof tool === "string")
    lines.push(`tools: [${tools.map((tool) => yamlScalar(tool)).join(", ")}]`)
  }
  if (typeof object.metadata.rung_ceiling === "string" && object.metadata.rung_ceiling) {
    lines.push(`rung_ceiling: ${yamlScalar(object.metadata.rung_ceiling)}`)
  }
  lines.push("---", object.body)
  return lines.join("\n")
}

export function renderTeamObjectFile(object: {
  kind: TeamObjectKind
  name: string
  body: string
  metadata: Record<string, unknown>
}): string {
  return object.kind === "skill" ? renderSkillFile(object) : renderAgentDefinitionFile(object)
}

/**
 * Queue a locally authored object for push. Called by the publish
 * command (the v1 authoring path — the spec prescribes no session-end
 * auto-push for documents). Local admission runs here: an invalid or
 * credential-shaped object is recorded as a terminal rejection and
 * never leaves the machine. When `supersedes` is not set explicitly,
 * it is wired to the chain's last known head — this repo's own last
 * push, else the head the mirror last pulled.
 */
export async function queueTeamObjectPush(
  cwd: string,
  object: TeamObjectWire,
  deps?: TeamObjectDeps,
): Promise<QueueResult> {
  const state = await loadTeamSyncState(cwd, deps)
  if (!state.enabled) return "disabled"
  const journal = state.objects
  if (journal.pushed[object.id] || journal.rejected[object.id]) return "duplicate"
  if (journal.pending.some((entry) => entry.id === object.id)) return "duplicate"
  const reason = validateTeamObject(object)
  if (reason) {
    journal.rejected[object.id] = { reason, at: (deps?.now ?? Date.now)() }
    await saveTeamSyncState(cwd, state, deps)
    gristWarn(`[grist:team-objects] object ${object.id} held locally: ${reason}`)
    return "rejected"
  }
  const key = teamObjectChainKey(object.kind, object.container, object.name)
  const wired: TeamObjectWire = {
    ...object,
    supersedes: object.supersedes ?? journal.pushedHeads[key] ?? journal.manifest[key]?.id ?? null,
  }
  journal.pending.push(wired)
  await saveTeamSyncState(cwd, state, deps)
  return "queued"
}

type ObjectPushResultRow = { id: string | null; result: string; reason?: string }

export type ObjectPushSummary = {
  attempted: number
  stored: number
  rejected: number
  pending: number
  error?: string
}

/**
 * Revocation, objects side: the materialized mirror is wiped (files
 * and manifest), the objects cursor resets, and the shared `revoked`
 * pause is set. Pending publishes stay queued, exactly as memory's
 * pending entries do — they belong to the author, not the team.
 */
async function applyObjectsRevoked(cwd: string, state: TeamSyncState, deps?: TeamObjectDeps): Promise<void> {
  const removeDir = deps?.removeDir ?? defaultRemoveDir
  await removeDir(teamObjectsRoot(cwd)).catch(() => undefined)
  await removeDir(teamGlobalObjectsRoot(cwd)).catch(() => undefined)
  state.objects.cursor = 0
  state.objects.manifest = {}
  state.objects.pushedHeads = {}
  state.revoked = true
  await saveTeamSyncState(cwd, state, deps)
}

/**
 * Push the pending object queue to the gateway, in batches. Best-
 * effort throughout: transport/HTTP failures leave un-acked objects
 * pending for the next sync and record `lastError`.
 */
export async function flushTeamObjectPushes(cwd: string, deps?: TeamObjectDeps): Promise<ObjectPushSummary> {
  const state = await loadTeamSyncState(cwd, deps)
  const journal = state.objects
  const done = (error?: string): ObjectPushSummary => ({
    attempted: 0,
    stored: 0,
    rejected: 0,
    pending: journal.pending.length,
    ...(error ? { error } : {}),
  })
  if (!state.enabled || state.revoked || journal.pending.length === 0) return done()
  const config = (deps?.loadConfig ?? loadInviteConfig)()
  if (!config) return done("not signed in")

  const summary = done()
  const doFetch = deps?.fetch ?? fetch
  while (journal.pending.length > 0) {
    const batch = journal.pending.slice(0, PUSH_BATCH)
    let response: Response
    try {
      response = await doFetch(`${config.gatewayUrl}/v1/team-objects/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...gatewayAuthHeaders(config) },
        body: JSON.stringify({ objects: batch }),
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      summary.error = error instanceof Error ? error.message : String(error)
      break
    }
    if (response.status === 409) {
      // Not in a team (anymore): same revocation semantics as pull.
      await applyObjectsRevoked(cwd, state, deps)
      summary.error = "not in a team"
      break
    }
    if (!response.ok) {
      summary.error = `gateway object push failed: HTTP ${response.status}`
      break
    }
    const body = (await response.json().catch(() => undefined)) as { results?: ObjectPushResultRow[] } | undefined
    const results = new Map((body?.results ?? []).map((row) => [row.id, row]))
    const decided = new Set<string>()
    for (const object of batch) {
      const row = results.get(object.id)
      if (!row) continue
      decided.add(object.id)
      summary.attempted++
      if (row.result === "stored") {
        journal.pushed[object.id] = { at: (deps?.now ?? Date.now)() }
        journal.pushedHeads[teamObjectChainKey(object.kind, object.container, object.name)] = object.id
        summary.stored++
      } else {
        journal.rejected[object.id] = { reason: row.reason ?? "rejected", at: (deps?.now ?? Date.now)() }
        summary.rejected++
      }
    }
    journal.pending = journal.pending.filter((object) => !decided.has(object.id))
    if (decided.size === 0) break
  }
  summary.pending = journal.pending.length
  if (!summary.error) {
    journal.lastPushAt = (deps?.now ?? Date.now)()
    delete journal.lastError
  } else {
    journal.lastError = summary.error
  }
  await saveTeamSyncState(cwd, state, deps)
  if (summary.attempted > 0) {
    gristLog(
      `[grist:team-objects] push stored=${summary.stored} rejected=${summary.rejected} pending=${summary.pending}`,
    )
  }
  return summary
}

/** The publish path: queue one authored object and flush immediately. */
export async function publishTeamObject(
  cwd: string,
  object: TeamObjectWire,
  deps?: TeamObjectDeps,
): Promise<{ queue: QueueResult; push: ObjectPushSummary }> {
  const queue = await queueTeamObjectPush(cwd, object, deps)
  const push = await flushTeamObjectPushes(cwd, deps)
  return { queue, push }
}

export type ObjectPullSummary = {
  pulled: number
  tombstoned: number
  revoked: boolean
  cursor: number
  error?: string
}

type PulledObjectWire = TeamObjectWire & {
  author_user_id: string
  status: string
  seq: number
  is_head: boolean
  created_at: number
  updated_at: number
}

/**
 * Pull team objects since the objects cursor and materialize the heads
 * as files. Scoped to this repo's own container plus the team-global
 * container — other repos' objects are theirs. The cursor advances
 * only after every file is written and the journal is saved: a failed
 * materialization leaves the cursor untouched, so the same heads are
 * re-delivered next session and the writes converge idempotently.
 */
export async function pullTeamObjects(cwd: string, deps?: TeamObjectDeps): Promise<ObjectPullSummary> {
  const state = await loadTeamSyncState(cwd, deps)
  const journal = state.objects
  const base: ObjectPullSummary = { pulled: 0, tombstoned: 0, revoked: state.revoked, cursor: journal.cursor }
  if (!state.enabled) return base
  if (state.revoked) {
    // Revocation may have been recorded by the memory stream first;
    // the local object wipe still has to happen, network or not.
    if (Object.keys(journal.manifest).length > 0 || journal.cursor > 0) {
      await applyObjectsRevoked(cwd, state, deps)
    }
    return { ...base, revoked: true }
  }
  const config = (deps?.loadConfig ?? loadInviteConfig)()
  if (!config) return { ...base, error: "not signed in" }
  const ownContainer = deps?.container ?? containerForDirectory(cwd)

  let response: Response
  try {
    response = await (deps?.fetch ?? fetch)(`${config.gatewayUrl}/v1/team-objects/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...gatewayAuthHeaders(config) },
      body: JSON.stringify({
        since_seq: journal.cursor,
        containers: [ownContainer, TEAM_GLOBAL_CONTAINER],
      }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) return { ...base, error: `gateway object pull failed: HTTP ${response.status}` }
  const body = (await response.json().catch(() => undefined)) as
    | { revoked?: boolean; objects?: PulledObjectWire[]; tombstones?: string[]; next_seq?: number }
    | undefined
  if (!body) return { ...base, error: "gateway object pull returned an unreadable body" }
  if (body.revoked) {
    await applyObjectsRevoked(cwd, state, deps)
    return { pulled: 0, tombstoned: 0, revoked: true, cursor: 0 }
  }

  const writeFile = deps?.writeFile ?? (async (file: string, text: string) => {
    const fsp = await import("node:fs/promises")
    await fsp.writeFile(file, text, "utf-8")
  })
  const mkdir = deps?.mkdir ?? (async (dir: string) => {
    const fsp = await import("node:fs/promises")
    await fsp.mkdir(dir, { recursive: true })
  })
  const removeFile = deps?.removeFile ?? defaultRemoveFile

  try {
    let pulled = 0
    for (const wire of body.objects ?? []) {
      if (!wire || typeof wire.id !== "string" || typeof wire.body !== "string") continue
      if (wire.kind !== "skill" && wire.kind !== "agent_definition") continue
      if (wire.status && wire.status !== "active") continue
      const key = teamObjectChainKey(wire.kind, wire.container, wire.name)
      const file = teamObjectPath(cwd, ownContainer, wire)
      const content = renderTeamObjectFile(wire)
      const hash = hashTeamObjectContent(content)
      const existing = journal.manifest[key]
      if (!existing || existing.id !== wire.id || existing.hash !== hash) {
        await mkdir(path.dirname(file))
        await writeFile(file, content)
      }
      journal.manifest[key] = {
        kind: wire.kind,
        container: wire.container,
        name: wire.name,
        id: wire.id,
        seq: typeof wire.seq === "number" ? wire.seq : 0,
        hash,
        path: path.relative(cwd, file),
        authorUserId: typeof wire.author_user_id === "string" ? wire.author_user_id : "unknown",
      }
      pulled++
    }
    let tombstoned = 0
    for (const id of body.tombstones ?? []) {
      for (const [key, entry] of Object.entries(journal.manifest)) {
        if (entry.id !== id) continue
        await removeFile(path.join(cwd, entry.path))
        delete journal.manifest[key]
        tombstoned++
      }
    }
    if (typeof body.next_seq === "number" && Number.isFinite(body.next_seq)) {
      journal.cursor = body.next_seq
    }
    journal.lastPullAt = (deps?.now ?? Date.now)()
    delete journal.lastError
    await saveTeamSyncState(cwd, state, deps)
    if (pulled > 0 || tombstoned > 0) {
      gristLog(`[grist:team-objects] pull objects=${pulled} tombstones=${tombstoned} cursor=${journal.cursor}`)
    }
    return { pulled, tombstoned, revoked: false, cursor: journal.cursor }
  } catch (error) {
    // Nothing was saved: the cursor stays put and the same delta is
    // re-delivered next session. Files already written are complete
    // and hash-identical to what the retry would write.
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Session-start object sync: flush anything queued offline, then pull + materialize. */
export async function syncTeamObjects(
  cwd: string,
  deps?: TeamObjectDeps,
): Promise<{ push: ObjectPushSummary; pull: ObjectPullSummary }> {
  const push = await flushTeamObjectPushes(cwd, deps)
  const pull = await pullTeamObjects(cwd, deps)
  return { push, pull }
}

export type TeamObjectStatus = {
  enabled: boolean
  revoked: boolean
  cursor: number
  materialized: TeamObjectManifestEntry[]
  pendingCount: number
  pushedCount: number
  rejectedCount: number
  lastPushAt?: number
  lastPullAt?: number
  lastError?: string
  teamRoot: string
  globalRoot: string
}

export function summarizeTeamObjects(state: TeamSyncState, cwd: string): TeamObjectStatus {
  const journal: TeamObjectJournal = state.objects
  return {
    enabled: state.enabled,
    revoked: state.revoked,
    cursor: journal.cursor,
    materialized: Object.values(journal.manifest).toSorted((a, b) =>
      teamObjectChainKey(a.kind, a.container, a.name).localeCompare(teamObjectChainKey(b.kind, b.container, b.name)),
    ),
    pendingCount: journal.pending.length,
    pushedCount: Object.keys(journal.pushed).length,
    rejectedCount: Object.keys(journal.rejected).length,
    ...(journal.lastPushAt ? { lastPushAt: journal.lastPushAt } : {}),
    ...(journal.lastPullAt ? { lastPullAt: journal.lastPullAt } : {}),
    ...(journal.lastError ? { lastError: journal.lastError } : {}),
    teamRoot: teamObjectsRoot(cwd),
    globalRoot: teamGlobalObjectsRoot(cwd),
  }
}
