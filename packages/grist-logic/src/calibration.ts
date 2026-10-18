import type { BurnInEvent } from "./burn-in.js"
import { misrouteTable } from "./failure-mining.js"
import { DEFAULT_THRESHOLDS, type GateThresholds } from "./thresholds.js"

/**
 * R4 — gate calibration suggestions from burn-in evidence.
 *
 * Conservative by design: evidence-gated (no suggestion without enough
 * joined decision→outcome runs), one bounded step per knob per run, and
 * suggestions only — applying them is a config change a human commits
 * (the env names below are the audit trail). Mirrors the calibration
 * study question in the goal backlog: is the prompt-time gate accurate,
 * or does between-turn escalation do the correcting?
 */

export const CALIBRATION_MIN_TOTAL_RUNS = 15
export const CALIBRATION_MIN_RUNG_RUNS = 8
export const CALIBRATION_STEP = 0.05

export type CalibrationSuggestion = {
  knob: keyof GateThresholds
  env: string
  from: number
  to: number
  evidence: string
}

export type CalibrationResult = {
  joinedRuns: number
  suggestions: CalibrationSuggestion[]
  verdict: string
}

const ENV_FOR: Record<keyof GateThresholds, string> = {
  difficultyMedium: "GRIST_TH_DIFF_MEDIUM",
  difficultyFrontier: "GRIST_TH_DIFF_FRONTIER",
  difficultyPremium: "GRIST_TH_DIFF_PREMIUM",
  underspecifiedCheapest: "GRIST_TH_UNDER_CHEAPEST",
  sensitivityCapCheapest: "GRIST_TH_SENS_CHEAPEST",
  sensitivityCapMedium: "GRIST_TH_SENS_MEDIUM",
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function suggest(
  out: CalibrationSuggestion[],
  knob: keyof GateThresholds,
  current: GateThresholds,
  delta: number,
  floor: number,
  cap: number,
  evidence: string,
) {
  const from = current[knob]
  const to = round2(Math.min(cap, Math.max(floor, from + delta)))
  if (to === from) return
  out.push({ knob, env: ENV_FOR[knob], from, to, evidence })
}

export function suggestCalibration(
  events: BurnInEvent[],
  current: GateThresholds = DEFAULT_THRESHOLDS,
): CalibrationResult {
  const table = misrouteTable(events)
  const joinedRuns = table.reduce((sum, row) => sum + row.runs, 0)
  if (joinedRuns < CALIBRATION_MIN_TOTAL_RUNS) {
    return {
      joinedRuns,
      suggestions: [],
      verdict: `Insufficient evidence: ${joinedRuns} joined runs (need ${CALIBRATION_MIN_TOTAL_RUNS}). Keep collecting burn-in before touching thresholds.`,
    }
  }

  const suggestions: CalibrationSuggestion[] = []
  const cheapest = table.find((r) => r.rung === "cheapest")!
  const medium = table.find((r) => r.rung === "medium")!
  const frontier = table.find((r) => r.rung === "frontier")!
  const premium = table.find((r) => r.rung === "premium")!

  // Under-routing at the cheapest boundary, either signal:
  // (a) escalation-dependent success — most cheap starts need a rescue and
  //     the rescue usually works, so the first attempt is wasted spend;
  // (b) outright failure — cheap starts fail even after escalation.
  const cheapestEscalationShare = cheapest.runs ? cheapest.escalatedRuns / cheapest.runs : 0
  const escalationDependent =
    cheapest.runs >= CALIBRATION_MIN_RUNG_RUNS &&
    cheapestEscalationShare >= 0.4 &&
    cheapest.rescueRate !== null &&
    cheapest.rescueRate >= 0.5
  const outrightFailing =
    cheapest.runs >= CALIBRATION_MIN_RUNG_RUNS &&
    cheapest.successRate !== null &&
    cheapest.successRate < 0.6
  if (escalationDependent || outrightFailing) {
    suggest(
      suggestions,
      "difficultyMedium",
      current,
      -CALIBRATION_STEP,
      0.25,
      0.55,
      `cheapest over ${cheapest.runs} runs: success ${cheapest.successRate === null ? "—" : (cheapest.successRate * 100).toFixed(0)}%, escalated ${(cheapestEscalationShare * 100).toFixed(0)}% of starts, rescue rate ${cheapest.rescueRate === null ? "—" : (cheapest.rescueRate * 100).toFixed(0)}% — the prompt-time gate under-routes and between-turn correction does the work.`,
    )
  }

  // Headroom at the cheapest boundary: cheap starts nearly always succeed
  // and almost never need escalation → widen the cheapest band.
  if (
    cheapest.runs >= CALIBRATION_MIN_RUNG_RUNS &&
    cheapest.successRate !== null &&
    cheapest.successRate >= 0.95 &&
    cheapest.escalatedRuns <= 1 &&
    !suggestions.some((s) => s.knob === "difficultyMedium")
  ) {
    suggest(
      suggestions,
      "difficultyMedium",
      current,
      +0.03,
      0.25,
      0.55,
      `cheapest success ${(cheapest.successRate * 100).toFixed(0)}% over ${cheapest.runs} runs with ${cheapest.escalatedRuns} escalations — widen the cheapest band to save spend.`,
    )
  }

  // Same under-routing pattern one rung up.
  if (
    medium.runs >= CALIBRATION_MIN_RUNG_RUNS &&
    medium.successRate !== null &&
    medium.successRate < 0.7 &&
    medium.escalatedRuns >= 4 &&
    medium.rescueRate !== null &&
    medium.rescueRate >= 0.5
  ) {
    suggest(
      suggestions,
      "difficultyFrontier",
      current,
      -CALIBRATION_STEP,
      0.6,
      0.85,
      `medium success ${(medium.successRate * 100).toFixed(0)}% over ${medium.runs} runs; escalation rescued ${(medium.rescueRate * 100).toFixed(0)}% — start borderline tasks at frontier sooner.`,
    )
  }

  // Expensive-share guard (burn-in rule: frontier + premium ≤ 5% of runs)
  // when the expensive rungs are not buying accuracy.
  const expensiveRuns = frontier.runs + premium.runs
  const expensiveShare = joinedRuns ? expensiveRuns / joinedRuns : 0
  const expensiveSuccess =
    expensiveRuns > 0
      ? (frontier.successes + premium.successes) / expensiveRuns
      : null
  if (
    expensiveShare > 0.05 &&
    expensiveSuccess !== null &&
    medium.successRate !== null &&
    expensiveSuccess <= medium.successRate + 0.1 &&
    !suggestions.some((s) => s.knob === "difficultyFrontier")
  ) {
    suggest(
      suggestions,
      "difficultyFrontier",
      current,
      +0.03,
      0.6,
      0.85,
      `frontier+premium are ${(expensiveShare * 100).toFixed(0)}% of runs (guard: ≤5%) with success ${(expensiveSuccess * 100).toFixed(0)}% vs medium ${(medium.successRate * 100).toFixed(0)}% — the expensive rungs are not buying accuracy.`,
    )
  }

  return {
    joinedRuns,
    suggestions,
    verdict: suggestions.length
      ? `${suggestions.length} suggestion(s) from ${joinedRuns} joined runs. Suggestions only — apply by committing the env overrides; nothing here mutates live config.`
      : `${joinedRuns} joined runs reviewed; thresholds look consistent with the evidence. No change suggested.`,
  }
}

export function formatCalibrationReport(result: CalibrationResult): string {
  const lines = ["# Grist gate calibration", "", result.verdict, ""]
  if (result.suggestions.length) {
    lines.push("## Suggestions", "")
    for (const s of result.suggestions) {
      lines.push(`- \`${s.env}=${s.to}\` (${s.knob}: ${s.from} → ${s.to})`)
      lines.push(`  Evidence: ${s.evidence}`)
    }
    lines.push("", "Apply by committing these overrides where the gateway/CLI reads env (thresholds.ts), or via `loadThresholdsFromJson` config.", "")
  }
  return lines.join("\n")
}

export function calibrationEnvFile(result: CalibrationResult): string {
  return result.suggestions.map((s) => `${s.env}=${s.to}`).join("\n") + (result.suggestions.length ? "\n" : "")
}
