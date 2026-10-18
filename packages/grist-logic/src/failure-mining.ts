import type { BurnInEvent } from "./burn-in.js"
import type { RememberInput } from "./memory/types.js"
import { PUBLIC_RUNGS, type Rung } from "./rung.js"

/**
 * R3 — failure learning: turn recorded failures into (a) negative memories
 * and (b) a misroute table for gate calibration.
 *
 * Two pure analyzers:
 * - `distillFailures` reads one session's tool history and proposes negative
 *   memories for repeated/terminal failure signatures. Admission still goes
 *   through the memory store's verified-outcomes gate — a failure is
 *   verified by the failing check itself (`check_failed`), never by an
 *   agent's say-so. Deterministic on purpose: failure data is already
 *   structured, and an LLM summarizer would inject unverified generation
 *   into a verified-only store.
 * - `misrouteTable` / `failureClusters` join burn-in decisions to outcomes
 *   per session: which starting rung, did escalation rescue it, where do
 *   failures cluster. This is the input the gate-calibration study needs.
 */

export type ToolPartLike = {
  type: string
  tool?: string
  state?: {
    status?: string
    error?: string
    output?: string
    input?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }
}

/** Normalize an error string into a stable signature for grouping. */
export function errorSignature(error: string): string {
  return error
    .split("\n")[0]
    ?.toLowerCase()
    .replace(/0x[0-9a-f]+/g, "#")
    .replace(/\b\d{4,}\b/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) ?? ""
}

export type FailureGroup = {
  tool: string
  signature: string
  count: number
  sample: string
}

export function groupFailures(parts: ToolPartLike[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>()
  for (const part of parts) {
    if (part.type !== "tool" || part.state?.status !== "error") continue
    const tool = part.tool ?? "unknown"
    const raw = part.state.error ?? ""
    const signature = errorSignature(raw)
    if (!signature) continue
    const key = `${tool}::${signature}`
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { tool, signature, count: 1, sample: raw.split("\n")[0]?.slice(0, 200) ?? "" })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

/**
 * Propose negative memories from a finished execution.
 * - Session recovered (outcome success): only *repeated* signatures qualify
 *   (count ≥ 2) — a single transient error that was immediately fixed is noise.
 * - Session failed: any signature qualifies; the terminal one matters most.
 */
export function distillFailures(input: {
  parts: ToolPartLike[]
  container: string
  recovered: boolean
  sessionID?: string
}): RememberInput[] {
  const threshold = input.recovered ? 2 : 1
  return groupFailures(input.parts)
    .filter((group) => group.count >= threshold)
    .slice(0, 3)
    .map((group) => ({
      content:
        `Negative example (${input.container}): the ${group.tool} tool failed ${group.count}× with "${group.sample}". ` +
        (input.recovered
          ? "The session eventually succeeded — check this failure mode before repeating the same approach."
          : "The session ended in failure after this error — treat this path as a known trap in this codebase."),
      container: input.container,
      outcome: "check_failed" as const,
      sessionID: input.sessionID,
      metadata: { kind: "negative_example", tool: group.tool, signature: group.signature },
    }))
}

// ---------------------------------------------------------------------------
// Burn-in mining: decisions ⨝ outcomes per session
// ---------------------------------------------------------------------------

export type MisrouteRow = {
  rung: Rung
  runs: number
  successes: number
  failures: number
  successRate: number | null
  escalatedRuns: number
  /** Escalated and still succeeded — the between-turn rescue did the work. */
  rescued: number
  /** Escalated and failed anyway. */
  escalationFailed: number
  rescueRate: number | null
}

type SessionJoin = {
  firstRung: Rung
  escalated: boolean
  outcome?: "success" | "fail"
  mode?: string
  topReason?: string
}

function joinSessions(events: BurnInEvent[]): SessionJoin[] {
  const bySession = new Map<string, { decisions: BurnInEvent[]; outcome?: "success" | "fail" }>()
  for (const event of events) {
    if (!event.sessionID) continue
    const entry = bySession.get(event.sessionID) ?? { decisions: [] }
    if (event.kind === "decision" && event.decision) entry.decisions.push(event)
    if (event.kind === "outcome" && (event.outcome === "success" || event.outcome === "fail")) {
      entry.outcome = event.outcome
    }
    bySession.set(event.sessionID, entry)
  }
  const joins: SessionJoin[] = []
  for (const entry of bySession.values()) {
    if (entry.decisions.length === 0) continue
    const sorted = [...entry.decisions].sort((a, b) => a.at - b.at)
    const first = sorted[0]?.decision
    if (!first) continue
    const firstIdx = PUBLIC_RUNGS.indexOf(first.rung)
    const escalated = sorted.some((e) => PUBLIC_RUNGS.indexOf(e.decision!.rung) > firstIdx)
    joins.push({
      firstRung: first.rung,
      escalated,
      outcome: entry.outcome,
      mode: first.mode,
      topReason: first.reasons[0],
    })
  }
  return joins
}

export function misrouteTable(events: BurnInEvent[]): MisrouteRow[] {
  const joins = joinSessions(events)
  return PUBLIC_RUNGS.map((rung) => {
    const rows = joins.filter((j) => j.firstRung === rung && j.outcome)
    const successes = rows.filter((j) => j.outcome === "success").length
    const failures = rows.filter((j) => j.outcome === "fail").length
    const escalated = rows.filter((j) => j.escalated)
    const rescued = escalated.filter((j) => j.outcome === "success").length
    const escalationFailed = escalated.filter((j) => j.outcome === "fail").length
    return {
      rung,
      runs: rows.length,
      successes,
      failures,
      successRate: rows.length ? successes / rows.length : null,
      escalatedRuns: escalated.length,
      rescued,
      escalationFailed,
      rescueRate: escalated.length ? rescued / escalated.length : null,
    }
  })
}

export type FailureCluster = { key: string; count: number }

export function failureClusters(events: BurnInEvent[]): FailureCluster[] {
  const counts = new Map<string, number>()
  for (const join of joinSessions(events)) {
    if (join.outcome !== "fail") continue
    const key = `${join.firstRung} | mode=${join.mode ?? "-"} | ${join.topReason ?? "-"}${join.escalated ? " | escalated" : ""}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

export function formatMiningReport(events: BurnInEvent[]): string {
  const table = misrouteTable(events)
  const clusters = failureClusters(events)
  const lines: string[] = ["# Grist burn-in mining report", ""]
  lines.push("## Misroute table (by starting rung)")
  lines.push("")
  lines.push("| rung | runs | success | fail | success rate | escalated | rescued | esc. failed | rescue rate |")
  lines.push("|---|---|---|---|---|---|---|---|---|")
  for (const row of table) {
    lines.push(
      `| ${row.rung} | ${row.runs} | ${row.successes} | ${row.failures} | ${row.successRate === null ? "—" : row.successRate.toFixed(2)} | ${row.escalatedRuns} | ${row.rescued} | ${row.escalationFailed} | ${row.rescueRate === null ? "—" : row.rescueRate.toFixed(2)} |`,
    )
  }
  lines.push("", "## Failure clusters (starting rung | mode | top gate reason)", "")
  if (clusters.length === 0) lines.push("(no labelled failures yet)")
  for (const cluster of clusters) lines.push(`- ${cluster.count}× ${cluster.key}`)
  lines.push("")
  lines.push(
    "Reading: a high rescue rate with a low starting-rung success rate means the prompt-time gate under-routes and between-turn escalation does the correcting — ground the initial gate with repo context (calibration study).",
  )
  return lines.join("\n")
}
