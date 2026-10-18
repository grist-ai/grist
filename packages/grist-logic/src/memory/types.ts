/** Verified-outcomes-only memory (pre-POC §6). */

export type OutcomeKind =
  | "tests_passed"
  | "user_approved"
  | "user_corrected"
  /**
   * Observed failure (R3): a tool/check failure the harness itself recorded.
   * Verified by observation — the failing check ran — not by generation.
   * Written by the failure distiller, not by agents through the memory tool.
   */
  | "check_failed"

export type MemoryRecord = {
  id: string
  content: string
  /** Project / repo container (Supermemory containerTag). */
  container: string
  outcome: OutcomeKind
  /** Optional decay weight 0–1; newer / stronger outcomes weigh more. */
  weight: number
  createdAt: number
  sessionID?: string
  metadata?: Record<string, string>
}

export type MemoryHit = {
  content: string
  score?: number
  id?: string
  outcome?: OutcomeKind
}

export type RememberInput = {
  content: string
  container: string
  outcome: OutcomeKind
  sessionID?: string
  metadata?: Record<string, string>
  weight?: number
}

export type RecallInput = {
  query: string
  container: string
  limit?: number
}

export interface MemoryStore {
  remember(input: RememberInput): Promise<MemoryRecord | undefined>
  recall(input: RecallInput): Promise<MemoryHit[]>
  status(): Promise<{ available: boolean; backend: string; detail: string }>
}
