import type { GateThresholds } from "../thresholds"
import { DEFAULT_THRESHOLDS } from "../thresholds"
import type { BurnInSummary } from "../burn-in"
import { composeRung, shadowScores } from "../jev-gate"
import type { Rung } from "../rung"

/** In-repo gate eval battery — no external pilot repo required. */
export type BatteryCase = {
  id: string
  text: string
  expectRung: Rung
}

export const GATE_BATTERY: BatteryCase[] = [
  {
    id: "trivial-rename",
    text: "Rename unused helper in src/graph/map.ts and update call sites.",
    expectRung: "cheapest",
  },
  {
    id: "underspecified",
    text: "Fix it.",
    expectRung: "cheapest",
  },
  {
    id: "auth-sensitive",
    text: "Harden the auth middleware to reject expired JWT secrets in production.",
    expectRung: "cheapest",
  },
  {
    id: "medium-refactor",
    text: "Refactor the session runner across multiple files to fix a race in concurrent drains.",
    expectRung: "medium",
  },
  {
    id: "frontier-redesign",
    text: "Redesign the concurrent session coordinator architecture and rewrite the drain algorithm for correctness across distributed workers.",
    expectRung: "frontier",
  },
]

export type BatteryResult = {
  id: string
  expectRung: Rung
  actualRung: Rung
  ok: boolean
  reasons: string[]
}

export function runGateBattery(
  cases: BatteryCase[] = GATE_BATTERY,
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
): { results: BatteryResult[]; pass: number; total: number; ok: boolean } {
  const results = cases.map((c) => {
    const scores = shadowScores(c.text)
    const { rung, reasons } = composeRung(scores, thresholds)
    return {
      id: c.id,
      expectRung: c.expectRung,
      actualRung: rung,
      ok: rung === c.expectRung,
      reasons,
    }
  })
  const pass = results.filter((r) => r.ok).length
  return { results, pass, total: results.length, ok: pass === results.length }
}

/**
 * Suggest threshold nudges from burn-in tier mix (pre-POC §9).
 * Does not write env — caller applies GRIST_TH_* after review.
 */
export function suggestThresholds(summary: BurnInSummary): Partial<GateThresholds> & {
  notes: string[]
} {
  const notes: string[] = []
  const next: Partial<GateThresholds> = {}

  if (summary.decisions === 0) {
    notes.push("no_data")
    return { ...next, notes }
  }

  if (summary.frontierShare > 0.05) {
    next.difficultyFrontier = Math.min(0.95, DEFAULT_THRESHOLDS.difficultyFrontier + 0.05)
    notes.push("raise_difficulty_frontier (frontier share >5%)")
  }
  if (summary.tierMix.cheapest < 0.8) {
    next.difficultyMedium = Math.min(0.7, DEFAULT_THRESHOLDS.difficultyMedium + 0.05)
    notes.push("raise_difficulty_medium (cheapest share <80%)")
  }
  if (summary.frontierShare < 0.01 && summary.tierMix.cheapest > 0.9) {
    next.difficultyMedium = Math.max(0.25, DEFAULT_THRESHOLDS.difficultyMedium - 0.05)
    notes.push("lower_difficulty_medium (mix very cheap — probe boundary)")
  }
  if (notes.length === 0) notes.push("targets_met_no_change")
  return { ...next, notes }
}
