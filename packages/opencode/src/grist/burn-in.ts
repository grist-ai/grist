import path from "path"
import type { MechanismSet } from "./mechanisms"
import type { OperatingMode } from "./mode"
import type { Rung } from "./rung"

export type BurnInOutcome = "success" | "fail" | "escalated" | "unknown"

export type BurnInDecision = {
  rung: Rung
  provider: string
  mode?: OperatingMode
  mechanisms?: Pick<MechanismSet, "resolved" | "observationPack" | "observationPackCompressor" | "actionFusion">
  difficulty: number
  sensitivity: number
  underspecified: number
  reasons: string[]
  latencyMs: number
  model: { providerID: string; modelID: string }
  textPreview?: string
}

export type BurnInEvent = {
  id: string
  at: number
  kind: "decision" | "outcome"
  sessionID?: string
  decision?: BurnInDecision
  /** For outcome rows: which decision id / session this labels. */
  decisionID?: string
  outcome?: BurnInOutcome
  /** Counterfactual: would a cheaper rung have been enough? */
  cheaperWouldSucceed?: boolean
  notes?: string
}

export type BurnInSummary = {
  decisions: number
  byRung: Record<Rung, number>
  tierMix: Record<Rung, number>
  outcomes: number
  successRate: number
  /** Among successes, share that were on cheapest. */
  cheapestSuccessShare: number
  /** Escalation precision proxy: outcomes labeled escalated that truly needed it
   * (cheaperWouldSucceed === false). */
  escalationPrecision: number | null
  frontierShare: number
  premiumShare: number
}

const emptyCounts = (): Record<Rung, number> => ({
  cheapest: 0,
  medium: 0,
  frontier: 0,
  premium: 0,
})

export function summarize(events: BurnInEvent[]): BurnInSummary {
  const byRung = emptyCounts()
  const decisions = events.filter((e) => e.kind === "decision" && e.decision)
  for (const e of decisions) {
    byRung[e.decision!.rung] += 1
  }
  const total = decisions.length || 1
  const tierMix = {
    cheapest: byRung.cheapest / total,
    medium: byRung.medium / total,
    frontier: byRung.frontier / total,
    premium: byRung.premium / total,
  }

  const outcomes = events.filter((e) => e.kind === "outcome" && e.outcome && e.outcome !== "unknown")
  const successes = outcomes.filter((e) => e.outcome === "success")
  const successRate = outcomes.length ? successes.length / outcomes.length : 0

  const decisionByID = new Map(
    decisions.filter((e) => e.id).map((e) => [e.id, e] as const),
  )
  let cheapestSuccesses = 0
  for (const o of successes) {
    const d = o.decisionID ? decisionByID.get(o.decisionID) : undefined
    if (d?.decision?.rung === "cheapest") cheapestSuccesses += 1
  }
  const cheapestSuccessShare = successes.length ? cheapestSuccesses / successes.length : 0

  const escalated = outcomes.filter((e) => e.outcome === "escalated" || e.cheaperWouldSucceed !== undefined)
  const withCounterfactual = escalated.filter((e) => e.cheaperWouldSucceed !== undefined)
  const needed = withCounterfactual.filter((e) => e.cheaperWouldSucceed === false)
  const escalationPrecision = withCounterfactual.length ? needed.length / withCounterfactual.length : null

  return {
    decisions: decisions.length,
    byRung,
    tierMix,
    outcomes: outcomes.length,
    successRate,
    cheapestSuccessShare,
    escalationPrecision,
    frontierShare: tierMix.frontier,
    premiumShare: tierMix.premium,
  }
}

/** Targets from pre-POC §9: ≥80% cheapest / ≤5% frontier+premium. */
export function meetsTierMixTargets(summary: BurnInSummary): {
  ok: boolean
  reasons: string[]
} {
  if (summary.decisions === 0) return { ok: true, reasons: ["no_data"] }
  const reasons: string[] = []
  if (summary.tierMix.cheapest < 0.8) {
    reasons.push(`cheapest_share=${summary.tierMix.cheapest.toFixed(3)} < 0.80`)
  }
  const expensiveShare = summary.frontierShare + summary.premiumShare
  if (expensiveShare > 0.05) {
    reasons.push(`expensive_share=${expensiveShare.toFixed(3)} > 0.05`)
  }
  return { ok: reasons.length === 0, reasons }
}

export function burnInPath(cwd = process.cwd()) {
  return process.env.GRIST_BURNIN_PATH ?? path.join(cwd, ".grist", "burn-in.jsonl")
}

export function createBurnInLog(input?: {
  filePath?: string
  appendFile?: (path: string, line: string) => Promise<void>
  mkdir?: (path: string) => Promise<void>
  readFile?: (path: string) => Promise<string>
}) {
  const filePath = input?.filePath ?? burnInPath()
  const appendFile =
    input?.appendFile ??
    (async (file: string, line: string) => {
      const fs = await import("node:fs/promises")
      await fs.appendFile(file, line, "utf-8")
    })
  const mkdir =
    input?.mkdir ??
    (async (dir: string) => {
      const fs = await import("node:fs/promises")
      await fs.mkdir(dir, { recursive: true })
    })
  const readFile =
    input?.readFile ??
    (async (file: string) => {
      const fs = await import("node:fs/promises")
      return fs.readFile(file, "utf-8")
    })

  async function write(event: BurnInEvent) {
    if (process.env.GRIST_BURNIN === "off") return
    await mkdir(path.dirname(filePath))
    await appendFile(filePath, JSON.stringify(event) + "\n")
  }

  return {
    path: filePath,
    async recordDecision(input: {
      decision: BurnInDecision & { mechanisms?: MechanismSet }
      sessionID?: string
      text?: string
    }) {
      const id = crypto.randomUUID()
      const preview = input.text?.trim().slice(0, 240)
      const mech = input.decision.mechanisms
      await write({
        id,
        at: Date.now(),
        kind: "decision",
        sessionID: input.sessionID,
        decision: {
          rung: input.decision.rung,
          provider: input.decision.provider,
          mode: input.decision.mode,
          difficulty: input.decision.difficulty,
          sensitivity: input.decision.sensitivity,
          underspecified: input.decision.underspecified,
          reasons: input.decision.reasons,
          latencyMs: input.decision.latencyMs,
          model: input.decision.model,
          ...(mech
            ? {
                mechanisms: {
                  resolved: mech.resolved,
                  observationPack: mech.observationPack,
                  observationPackCompressor: mech.observationPackCompressor,
                  actionFusion: mech.actionFusion,
                },
              }
            : {}),
          ...(preview ? { textPreview: preview } : {}),
        },
      })
      return id
    },
    async recordOutcome(input: {
      decisionID?: string
      sessionID?: string
      outcome: BurnInOutcome
      cheaperWouldSucceed?: boolean
      notes?: string
    }) {
      await write({
        id: crypto.randomUUID(),
        at: Date.now(),
        kind: "outcome",
        sessionID: input.sessionID,
        decisionID: input.decisionID,
        outcome: input.outcome,
        cheaperWouldSucceed: input.cheaperWouldSucceed,
        notes: input.notes,
      })
    },
    async load(): Promise<BurnInEvent[]> {
      try {
        const raw = await readFile(filePath)
        return raw
          .split("\n")
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as BurnInEvent]
            } catch {
              return []
            }
          })
      } catch {
        return []
      }
    },
    async report() {
      const events = await this.load()
      const summary = summarize(events)
      return { summary, targets: meetsTierMixTargets(summary), path: filePath }
    },
  }
}
