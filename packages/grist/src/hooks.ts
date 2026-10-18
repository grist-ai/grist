/**
 * Grist control-plane hook wiring (v2 plugin).
 *
 * Maps the v1 session/agent-loop integration points onto the v2 hook surface:
 * - `session.prompt`        → Jev gate: route the task, switch the session to the gated rung
 * - `session.context`       → inject the surgical-engineer doctrine into the system prompt
 * - `session.model.request` (primary) → between-turn judgment; escalate via switchModel
 * - `session.compaction`    → compaction guard (observe; floors in the rung models are the fix)
 * - `tool.execute.before`   → exploratory tool budget; block by failing with Tool.Error
 * - `tool.execute.after`    → per-session tool stats + post-edit verify nudge + warm-subagent resume nudge
 * - `permission.evaluate`   → auto-allow override (never force ask/deny)
 *
 * Kill switch: `GRIST_CTRL=off` makes every hook a no-op.
 */
import { SystemPart } from "@opencode/ai"
import type { Context as PluginContext } from "@opencode/plugin/effect/plugin"
import { Model } from "@opencode/schema/model"
import { Tool } from "@opencode/schema/tool"
import { Effect, Scope, Stream } from "effect"

import { controlPlaneEnabled } from "@grist-ai/logic"
import {
  createBurnInLog,
  distillFailures,
  outcomeForExecution,
  recordTaskUsage,
  taskUsageFromStepEnded,
  type MemoryStore,
} from "@grist-ai/logic"
import { routeTask } from "@grist-ai/logic"
import {
  decideContinue,
  decidePermission,
  decideToolBudget,
  decideVerify,
  noteResume,
  recordWarmChild,
  shouldNudge,
  warmSubagentsEnabled,
} from "@grist-ai/logic"
import { surgicalEngineer } from "@grist-ai/logic"
import { gristLog, gristWarn } from "@grist-ai/logic"
import { GRIST_PROVIDER_ID, publicRungFor, type Rung } from "@grist-ai/logic"

import { truncateHistory } from "./history-truncation.js"

/** v1 ToolPartLike shape, accumulated per session from `tool.execute.after`. */
type ToolPartLike = {
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

const toolHistory = new Map<string, ToolPartLike[]>()
const primarySteps = new Map<string, number>()
/** Last known model per gated session — joins step/usage events to a rung (R0). */
const sessionModels = new Map<string, { providerID: string; modelID: string }>()

/**
 * R0 observability: translate durable session events into the records that
 * close the learning loop — per-step usage (`recordTaskUsage`) and
 * per-execution outcomes (burn-in `recordOutcome`). Both functions existed
 * in v2 with zero callers; this subscription is the wiring. Only sessions
 * the gate has seen are recorded.
 */
function handleSessionEvent(event: { type: string; data?: Record<string, unknown> }): void {
  if (!controlPlaneEnabled()) return
  const data = event.data ?? {}
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
  if (!sessionID) return
  if (event.type === "session.step.ended") {
    const model = sessionModels.get(sessionID)
    if (!model) return
    const usage = taskUsageFromStepEnded(data, model)
    if (usage) recordTaskUsage(usage)
    return
  }
  const mapped = outcomeForExecution(event.type)
  if (!mapped) return
  const notes =
    event.type === "session.execution.interrupted" && typeof data.reason === "string"
      ? `interrupted:${data.reason}`
      : undefined
  void createBurnInLog()
    .recordOutcome({ sessionID, outcome: mapped.outcome, notes })
    .catch((error) => gristWarn("[grist:burn-in] outcome record failed", error))
  // R3: on a terminal outcome, distill repeated/terminal tool failures from
  // this session's history into negative memories (verified by the failing
  // checks themselves). Fire-and-forget; deduped per session and against
  // the store so the same trap is only ever written once.
  if ((mapped.outcome === "success" || mapped.outcome === "fail") && learningMemory) {
    void distillSessionFailures(sessionID, mapped.outcome === "success").catch((error) =>
      gristWarn("[grist:learn] failure distillation failed", error),
    )
  }
}

/** R3 learning sink, configured by the plugin when a memory store resolved. */
let learningMemory: { store: MemoryStore; container: string } | undefined
const distilledSignatures = new Map<string, Set<string>>()

export function configureFailureLearning(input: { store: MemoryStore; container: string }): void {
  learningMemory = input
}

async function distillSessionFailures(sessionID: string, recovered: boolean): Promise<void> {
  if (!learningMemory) return
  const { store, container } = learningMemory
  const seen = distilledSignatures.get(sessionID) ?? new Set<string>()
  distilledSignatures.set(sessionID, seen)
  const candidates = distillFailures({
    parts: toolHistory.get(sessionID) ?? [],
    container,
    recovered,
    sessionID,
  })
  for (const candidate of candidates) {
    const signature = candidate.metadata?.signature ?? candidate.content
    if (seen.has(signature)) continue
    seen.add(signature)
    const sample = candidate.content.match(/with "([^"]+)"/)?.[1]
    if (sample) {
      const hits = await store.recall({ query: sample, container, limit: 3 })
      if (hits.some((hit) => hit.content.includes(sample))) continue
    }
    const record = await store.remember(candidate)
    if (record) {
      gristLog(
        `[grist:learn] negative memory stored session=${sessionID} tool=${candidate.metadata?.tool} id=${record.id}`,
      )
    }
  }
}

function historyFor(sessionID: string): ToolPartLike[] {
  const existing = toolHistory.get(sessionID)
  if (existing) return existing
  const fresh: ToolPartLike[] = []
  toolHistory.set(sessionID, fresh)
  return fresh
}

function resultSnippet(result: Tool.Result): string {
  const content = result.content
  if (typeof content === "string") return content.slice(0, 500)
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .slice(0, 500)
  }
  return ""
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

/** Never let a hook failure break the session; only `tool.execute.before` may fail by design. */
function guarded(label: string, run: () => Promise<void>): Effect.Effect<void> {
  return Effect.promise(run).pipe(
    Effect.catch((error) => {
      gristWarn(`[grist:hooks] ${label} failed; continuing`, error)
      return Effect.void
    }),
  )
}

export function registerGristHooks(ctx: PluginContext): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    yield* ctx.session.hook("prompt", (input) =>
      guarded("session.prompt", async () => {
        if (!controlPlaneEnabled()) return
        const text = input.prompt.text.trim()
        if (!text) return
        const sessionID = input.sessionID
        const info = await Effect.runPromise(ctx.session.get({ sessionID }).pipe(Effect.option))
        const ref = info._tag === "Some" ? info.value.model : undefined
        if (ref && ref.providerID === GRIST_PROVIDER_ID) {
          sessionModels.set(sessionID, { providerID: ref.providerID, modelID: ref.id })
        }
        // Pinned = the user explicitly chose a non-grist model; never override it.
        const pinned = !!ref && ref.providerID !== GRIST_PROVIDER_ID && !publicRungFor(ref.id)
        const decision = await routeTask({
          text,
          current: ref
            ? { providerID: ref.providerID, modelID: ref.id }
            : { providerID: GRIST_PROVIDER_ID, modelID: "cheapest" as Rung },
          pinned,
          sessionID,
        })
        if (!decision || decision.reasons.includes("passthrough")) return
        await Effect.runPromise(
          ctx.session.switchModel({
            sessionID,
            model: Model.Ref.parse(`${GRIST_PROVIDER_ID}/${decision.rung}`),
          }),
        )
        sessionModels.set(sessionID, { providerID: GRIST_PROVIDER_ID, modelID: decision.rung })
        gristLog(`[grist:hooks] prompt gated session=${sessionID} rung=${decision.rung}`)
      }),
    )

    yield* ctx.session.hook("context", (input) =>
      guarded("session.context", async () => {
        if (!controlPlaneEnabled()) return
        input.system.push(SystemPart.make(surgicalEngineer(input.sessionID)))
        // Keep the serialized history under the gateway's 256 KB body cap; only
        // old tool output is shrunk, never the recent tail.
        const report = truncateHistory(input.messages)
        if (!report.truncated) return
        input.messages = report.messages
        gristLog(
          `[grist:hooks] context truncated session=${input.sessionID} bytes=${report.bytesDropped} parts=${report.partsShrunk} size=${report.finalSize}`,
        )
      }),
    )

    yield* ctx.session.hook("model.request", (input) =>
      guarded("session.model.request", async () => {
        if (!controlPlaneEnabled()) return
        if (input.kind !== "primary") return
        const sessionID = input.sessionID
        const step = (primarySteps.get(sessionID) ?? 0) + 1
        primarySteps.set(sessionID, step)
        if (step < 2) return
        const decision = await decideContinue({
          sessionID,
          step,
          parts: historyFor(sessionID),
        })
        // "stop" is intentionally not acted on: the stop heuristics were removed
        // by user order; v2's tool-driven loop ends on its own when the model
        // makes no more tool calls.
        if (decision.action === "escalate" && decision.rung) {
          await Effect.runPromise(
            ctx.session.switchModel({
              sessionID,
              model: Model.Ref.parse(`${GRIST_PROVIDER_ID}/${decision.rung}`),
            }),
          )
          sessionModels.set(sessionID, { providerID: GRIST_PROVIDER_ID, modelID: decision.rung })
          gristLog(`[grist:hooks] escalated session=${sessionID} rung=${decision.rung}`)
        }
      }),
    )

    yield* ctx.session.hook("compaction", (input) =>
      guarded("session.compaction", async () => {
        if (!controlPlaneEnabled()) return
        // Guard: the v1 runaway (spurious auto-compaction from degenerate
        // context budgets) is fixed by the per-rung floors in the model
        // definitions; v2 core owns overflow detection. Observe and log so the
        // burn-in record shows when compaction fires on grist sessions.
        if (input.model.providerID === GRIST_PROVIDER_ID) {
          gristLog(`[grist:hooks] compaction session=${input.sessionID} model=${input.model.id}`)
        }
      }),
    )

    yield* ctx.tool.hook("execute.before", (input) => {
      if (!controlPlaneEnabled()) return Effect.void
      return Effect.promise(() =>
        decideToolBudget({ sessionID: input.sessionID, toolID: input.tool }),
      ).pipe(
        Effect.flatMap((decision) => {
          if (decision.action !== "block") return Effect.void
          return Effect.fail(
            new Tool.Error({
              message: decision.message ?? "[grist:ctrl] Exploratory tool budget reached.",
            }),
          )
        }),
        Effect.catch((error) => {
          // A Tool.Error is the intended block signal; anything else is logged.
          if (error instanceof Tool.Error) return Effect.fail(error)
          gristWarn("[grist:hooks] tool.execute.before failed; continuing", error)
          return Effect.void
        }),
      )
    })

    yield* ctx.tool.hook("execute.after", (input) =>
      guarded("tool.execute.after", async () => {
        if (!controlPlaneEnabled()) return
        const history = historyFor(input.sessionID)
        const args = asRecord(input.input)
        if (input.status === "completed") {
          history.push({
            type: "tool",
            tool: input.tool,
            state: {
              status: "completed",
              output: resultSnippet(input.result),
              input: args,
              metadata: asRecord(input.result.metadata),
            },
          })
          if ((input.tool === "edit" || input.tool === "write") && typeof args?.filePath === "string") {
            const verify = await decideVerify({ sessionID: input.sessionID, filePath: args.filePath })
            if (verify.message) {
              const current = input.result.content
              const nudge = { type: "text" as const, text: verify.message }
              input.result = {
                ...input.result,
                content:
                  typeof current === "string"
                    ? `${current}\n\n${verify.message}`
                    : current
                      ? [...current, nudge]
                      : verify.message,
              }
            }
          }
          if (input.tool === "subagent" && warmSubagentsEnabled()) {
            const agent = typeof args?.agent === "string" ? args.agent : undefined
            const resumed =
              typeof args?.sessionID === "string" && args.sessionID.length > 0 ? args.sessionID : undefined
            const recorded = asRecord(input.result.metadata)?.sessionID
            const childID = resumed ?? (typeof recorded === "string" ? recorded : undefined)
            if (agent && childID) {
              if (resumed) noteResume(input.sessionID, agent, childID)
              else recordWarmChild(input.sessionID, agent, childID)
              if (shouldNudge(input.sessionID, agent)) {
                const message = `To re-dispatch ${agent} on a follow-up, pass sessionID: ${childID} to the subagent tool — resumes warm, skips re-briefing.`
                const current = input.result.content
                const nudge = { type: "text" as const, text: message }
                input.result = {
                  ...input.result,
                  content:
                    typeof current === "string"
                      ? `${current}\n\n${message}`
                      : current
                        ? [...current, nudge]
                        : message,
                }
              }
            }
          }
        } else {
          history.push({
            type: "tool",
            tool: input.tool,
            state: {
              status: "error",
              error: input.error.message,
              input: args,
            },
          })
        }
      }),
    )

    // R0: subscribe to the durable session-event stream for usage + outcome
    // records. Guarded end to end: if the stream is unavailable in this host
    // context, hooks keep working and only the records are skipped.
    yield* ctx.event
      .subscribe()
      .pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            try {
              handleSessionEvent(event as { type: string; data?: Record<string, unknown> })
            } catch (error) {
              gristWarn("[grist:hooks] session event handling failed; continuing", error)
            }
          }),
        ),
        Effect.catch((error) => {
          gristWarn("[grist:hooks] session event stream unavailable; usage/outcome records skipped", error)
          return Effect.void
        }),
        Effect.forkScoped,
      )

    yield* ctx.permission.hook("evaluate", (input) =>
      guarded("permission.evaluate", async () => {
        if (!controlPlaneEnabled()) return
        // Only ever override toward allow; never force ask/deny.
        if (input.effect !== "ask") return
        const decision = await decidePermission({
          sessionID: input.sessionID,
          permission: input.action,
          patterns: [...input.resources],
          metadata: input.metadata,
        })
        if (decision.action === "allow") {
          input.effect = "allow"
          gristLog(`[grist:hooks] permission auto-allow session=${input.sessionID} action=${input.action}`)
        }
      }),
    )
  })
}
