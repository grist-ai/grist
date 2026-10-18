import type { MemoryRecord, RememberInput } from "./types.js"
import { decayScore } from "./verified.js"

/**
 * Dreaming loop planner (shared-memory spec §15) — deterministic core.
 *
 * The scheduled curation agent's judgment calls are reduced to mechanical
 * policy here so every action is explainable and testable:
 * - **Merge** near-duplicates (same container + outcome, normalized content
 *   equal or token Jaccard ≥ 0.85): keep the stronger record, fold the
 *   rest in as citations.
 * - **Archive** stale records (decay score below the floor and old).
 * - **Supersede**: for one failure signature, a *newer* verified success
 *   retires the older `check_failed` trap (§15: newer verified outcome
 *   wins). A failure that recurs *after* a success is a contradiction —
 *   both are kept and flagged, never silently averaged.
 * - **Add patterns**: a failure signature seen in ≥3 records across ≥2
 *   sessions becomes a first-class recurring-pattern memory.
 * - **Restricted wall**: records with `metadata.tier === "restricted"` are
 *   never merged, archived, superseded, or patterned by the loop — counted
 *   as skipped, per the §15 hard policy invariant.
 *
 * The LLM curation pass from the spec can propose additions on top of this
 * plan later; nothing here depends on a model, so a dreaming run is free,
 * reproducible, and safe to schedule.
 */

export const DREAM_STALE_DECAY_FLOOR = 0.08
export const DREAM_STALE_MIN_AGE_DAYS = 45
export const DREAM_DUPE_JACCARD = 0.85
export const DREAM_PATTERN_MIN_RECORDS = 3
export const DREAM_PATTERN_MIN_SESSIONS = 2

export type DreamPlan = {
  merges: { keepID: string; dropIDs: string[]; citations: number }[]
  archives: { id: string; reason: "stale" | "superseded" }[]
  contradictions: { signature: string; ids: string[] }[]
  patterns: RememberInput[]
  skippedRestricted: number
}

function isRestricted(record: MemoryRecord): boolean {
  return record.metadata?.tier === "restricted"
}

function normalizeContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, " ").trim()
}

function tokenSet(content: string): Set<string> {
  return new Set(normalizeContent(content).split(/[^a-z0-9_./-]+/).filter(Boolean))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  const union = a.size + b.size - shared
  return union === 0 ? 0 : shared / union
}

export function planDream(records: MemoryRecord[], now = Date.now()): DreamPlan {
  const plan: DreamPlan = { merges: [], archives: [], contradictions: [], patterns: [], skippedRestricted: 0 }
  const live = records.filter((r) => {
    if (isRestricted(r)) {
      plan.skippedRestricted += 1
      return false
    }
    return true
  })
  const dropped = new Set<string>()

  // --- Merge near-duplicates -------------------------------------------------
  const byKey = new Map<string, MemoryRecord[]>()
  for (const record of live) {
    const key = `${record.container}::${record.outcome}`
    byKey.set(key, [...(byKey.get(key) ?? []), record])
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => b.weight - a.weight || b.createdAt - a.createdAt)
    const consumed = new Set<string>()
    for (const keeper of sorted) {
      if (consumed.has(keeper.id)) continue
      const keeperTokens = tokenSet(keeper.content)
      const drops: string[] = []
      for (const other of sorted) {
        if (other.id === keeper.id || consumed.has(other.id)) continue
        const dupe =
          normalizeContent(other.content) === normalizeContent(keeper.content) ||
          jaccard(keeperTokens, tokenSet(other.content)) >= DREAM_DUPE_JACCARD
        if (dupe) {
          drops.push(other.id)
          consumed.add(other.id)
          dropped.add(other.id)
        }
      }
      if (drops.length) {
        plan.merges.push({ keepID: keeper.id, dropIDs: drops, citations: drops.length + 1 })
      }
    }
  }

  const remaining = live.filter((r) => !dropped.has(r.id))

  // --- Supersede / contradict by failure signature ---------------------------
  const bySignature = new Map<string, MemoryRecord[]>()
  for (const record of remaining) {
    const signature = record.metadata?.signature
    if (!signature) continue
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), record])
  }
  const superseded = new Set<string>()
  for (const [signature, group] of bySignature) {
    const failures = group.filter((r) => r.outcome === "check_failed")
    const successes = group.filter((r) => r.outcome === "tests_passed")
    if (!failures.length || !successes.length) continue
    const newestSuccess = Math.max(...successes.map((r) => r.createdAt))
    const newestFailure = Math.max(...failures.map((r) => r.createdAt))
    if (newestSuccess > newestFailure) {
      for (const failure of failures) {
        superseded.add(failure.id)
        plan.archives.push({ id: failure.id, reason: "superseded" })
      }
    } else {
      plan.contradictions.push({ signature, ids: group.map((r) => r.id) })
    }
  }

  // --- Archive stale -----------------------------------------------------------
  const minAgeMs = DREAM_STALE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000
  for (const record of remaining) {
    if (superseded.has(record.id)) continue
    if (now - record.createdAt >= minAgeMs && decayScore(record, now) < DREAM_STALE_DECAY_FLOOR) {
      plan.archives.push({ id: record.id, reason: "stale" })
    }
  }

  // --- Synthesize recurring-failure patterns -----------------------------------
  // Occurrences are counted on the pre-merge live set: a merged duplicate is
  // still an occurrence of the failure (its citations fold into the keeper).
  const archivedIDs = new Set(plan.archives.map((a) => a.id))
  const active = remaining.filter((r) => !archivedIDs.has(r.id))
  const existingPatterns = new Set(
    active.filter((r) => r.metadata?.kind === "pattern").map((r) => r.metadata?.signature),
  )
  const liveBySignature = new Map<string, MemoryRecord[]>()
  for (const record of live) {
    const signature = record.metadata?.signature
    if (!signature) continue
    liveBySignature.set(signature, [...(liveBySignature.get(signature) ?? []), record])
  }
  for (const [signature, group] of liveBySignature) {
    const failures = group.filter((r) => r.outcome === "check_failed")
    if (failures.length < DREAM_PATTERN_MIN_RECORDS) continue
    // A newer verified success retires the trap — no pattern for solved problems.
    const successes = group.filter((r) => r.outcome === "tests_passed")
    if (successes.length && Math.max(...successes.map((r) => r.createdAt)) > Math.max(...failures.map((r) => r.createdAt))) continue
    const sessions = new Set(failures.map((r) => r.sessionID ?? r.id))
    if (sessions.size < DREAM_PATTERN_MIN_SESSIONS) continue
    if (existingPatterns.has(signature)) continue
    const sample = failures[0]!
    plan.patterns.push({
      content:
        `Recurring failure pattern (${sample.container}): the ${sample.metadata?.tool ?? "tool"} failure "${signature}" ` +
        `has occurred ${failures.length} times across ${sessions.size} sessions. Treat as a known trap: check for this before starting, and prefer the workaround recorded in the linked memories.`,
      container: sample.container,
      outcome: "check_failed",
      weight: 0.9,
      metadata: { kind: "pattern", signature, tool: sample.metadata?.tool ?? "", sessions: String(sessions.size) },
    })
  }

  return plan
}

/** Apply a plan to a record list (file-backend semantics). Pure. */
export function applyDream(
  records: MemoryRecord[],
  plan: DreamPlan,
  input?: { now?: number; idFactory?: () => string },
): MemoryRecord[] {
  const now = input?.now ?? Date.now()
  const idFactory = input?.idFactory ?? (() => crypto.randomUUID())
  const dropIDs = new Set<string>([
    ...plan.merges.flatMap((m) => m.dropIDs),
    ...plan.archives.map((a) => a.id),
  ])
  const mergeBy = new Map(plan.merges.map((m) => [m.keepID, m]))
  const kept = records
    .filter((r) => !dropIDs.has(r.id))
    .map((r) => {
      const merge = mergeBy.get(r.id)
      if (!merge) return r
      return {
        ...r,
        weight: Math.min(1, r.weight + 0.05),
        metadata: { ...r.metadata, citations: String(merge.citations) },
      }
    })
  const patterns: MemoryRecord[] = plan.patterns.map((p) => ({
    id: idFactory(),
    content: p.content,
    container: p.container,
    outcome: p.outcome,
    weight: p.weight ?? 0.9,
    createdAt: now,
    metadata: p.metadata,
  }))
  return [...kept, ...patterns]
}
