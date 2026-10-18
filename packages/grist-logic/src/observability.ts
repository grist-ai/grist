import type { BurnInOutcome } from "./burn-in.js"
import type { TaskUsage } from "./usage-log.js"

/**
 * R0 — event → observability record mapping (pure, tested).
 *
 * The v2 runtime emits durable session events; the plugin subscribes and
 * translates them into the two records that close the learning loop:
 * per-step usage (`recordTaskUsage`) and per-execution outcomes
 * (`burn-in recordOutcome`). In v1 both were wired from the session
 * processor; the v2 plugin rewrite dropped the callers, leaving the
 * functions dead. This module holds the mapping so the hook wiring stays
 * a thin adapter.
 */

export type StepEndedData = {
  sessionID?: unknown
  assistantMessageID?: unknown
  cost?: unknown
  tokens?: {
    input?: unknown
    output?: unknown
    reasoning?: unknown
    cache?: { read?: unknown; write?: unknown }
  }
}

export type SessionModelRef = { providerID: string; modelID: string }

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** `session.step.ended` → TaskUsage. Returns undefined when fields are unusable. */
export function taskUsageFromStepEnded(
  data: StepEndedData,
  model: SessionModelRef,
): TaskUsage | undefined {
  const sessionID = str(data.sessionID)
  const messageID = str(data.assistantMessageID)
  const costUsd = num(data.cost)
  if (!sessionID || !messageID || costUsd === undefined || !data.tokens) return undefined
  const input = num(data.tokens.input)
  const output = num(data.tokens.output)
  if (input === undefined || output === undefined) return undefined
  return {
    sessionID,
    messageID,
    providerID: model.providerID,
    modelID: model.modelID,
    tokens: {
      input,
      output,
      reasoning: num(data.tokens.reasoning) ?? 0,
      cache: {
        read: num(data.tokens.cache?.read) ?? 0,
        write: num(data.tokens.cache?.write) ?? 0,
      },
    },
    costUsd,
  }
}

/**
 * Execution lifecycle → burn-in outcome.
 * Interrupted runs carry no quality signal, so they label `unknown`
 * (excluded from success-rate math by the burn-in summarizer).
 */
export function outcomeForExecution(
  type: string,
): { outcome: BurnInOutcome } | undefined {
  if (type === "session.execution.succeeded") return { outcome: "success" }
  if (type === "session.execution.failed") return { outcome: "fail" }
  if (type === "session.execution.interrupted") return { outcome: "unknown" }
  return undefined
}
