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
import { Effect, Scope } from "effect"

import { controlPlaneEnabled } from "@grist-ai/logic"
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
        gristLog(`[grist:hooks] prompt gated session=${sessionID} rung=${decision.rung}`)
      }),
    )

    yield* ctx.session.hook("context", (input) =>
      guarded("session.context", async () => {
        if (!controlPlaneEnabled()) return
        input.system.push(SystemPart.make(surgicalEngineer(input.sessionID)))
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
