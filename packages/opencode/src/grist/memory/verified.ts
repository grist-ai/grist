import type { MemoryRecord, OutcomeKind, RememberInput } from "./types"

/**
 * Only persist verified outcomes (pre-POC §6):
 * tests passed, user approved, or explicit correction.
 * Never store unreviewed generations.
 */
const ALLOWED = new Set<OutcomeKind>(["tests_passed", "user_approved", "user_corrected"])

export function isVerifiedOutcome(outcome: OutcomeKind): boolean {
  return ALLOWED.has(outcome)
}

export function requireVerified(input: RememberInput): RememberInput | undefined {
  if (process.env.GRIST_MEMORY === "off") return undefined
  if (!isVerifiedOutcome(input.outcome)) return undefined
  const content = input.content.trim()
  if (!content) return undefined
  if (!input.container.trim()) return undefined
  return {
    ...input,
    content,
    weight: clampWeight(input.weight ?? defaultWeight(input.outcome)),
  }
}

export function defaultWeight(outcome: OutcomeKind): number {
  if (outcome === "user_corrected") return 1
  if (outcome === "user_approved") return 0.9
  return 0.75
}

function clampWeight(n: number) {
  if (Number.isNaN(n)) return 0.5
  return Math.min(1, Math.max(0.05, n))
}

/** Recency × outcome weight decay for local ranking (0–1). */
export function decayScore(record: MemoryRecord, now = Date.now()): number {
  const ageMs = Math.max(0, now - record.createdAt)
  const halfLifeDays = 30
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000
  const recency = Math.pow(0.5, ageMs / halfLifeMs)
  return record.weight * recency
}
