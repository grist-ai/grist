import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./memory.txt"
import { createMemoryStore, formatHits } from "@/grist/memory"
import { InstanceState } from "@/effect/instance-state"
import { PositiveInt } from "@opencode-ai/core/schema"
import path from "path"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["recall", "remember"]).annotate({
    description: "recall = search memories; remember = persist a verified outcome only",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Search query (required for recall)",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "Fact to persist (required for remember)",
  }),
  outcome: Schema.optional(Schema.Literals(["tests_passed", "user_approved", "user_corrected"])).annotate({
    description: "Verification kind — required for remember",
  }),
  container: Schema.optional(Schema.String).annotate({
    description: "Memory container / project tag (default: workspace folder name)",
  }),
  limit: Schema.optional(PositiveInt).annotate({
    description: "Max recall hits (default 8)",
  }),
})

export const MemoryTool = Tool.define(
  "memory",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        type Meta = {
          available: boolean
          backend?: string
          action?: string
          saved?: boolean
        }

        if (process.env.GRIST_MEMORY === "off") {
          const metadata: Meta = { available: false }
          return {
            title: "memory disabled",
            metadata,
            output: "memory is disabled (GRIST_MEMORY=off).",
          }
        }

        const instance = yield* InstanceState.context
        const store = createMemoryStore({ cwd: instance.directory })
        if (!store) {
          const metadata: Meta = { available: false }
          return {
            title: "memory unavailable",
            metadata,
            output: "No memory store available.",
          }
        }

        const status = yield* Effect.promise(() => store.status())
        const container =
          params.container?.trim() || path.basename(instance.worktree || instance.directory) || "default"

        if (params.action === "recall") {
          const query = params.query?.trim()
          if (!query) {
            return {
              title: "memory recall needs query",
              metadata: { available: true, backend: status.backend, action: "recall" } satisfies Meta,
              output: "Provide query=... for recall.",
            }
          }
          const hits = yield* Effect.promise(() =>
            store.recall({ query, container, limit: params.limit }),
          )
          return {
            title: `memory recall ${query}`,
            metadata: { available: true, backend: status.backend, action: "recall" } satisfies Meta,
            output: formatHits({ query, hits, backend: status.backend }),
          }
        }

        if (!params.content?.trim() || !params.outcome) {
          return {
            title: "memory remember needs content+outcome",
            metadata: { available: true, backend: status.backend, action: "remember" } satisfies Meta,
            output: "remember requires content and outcome (tests_passed|user_approved|user_corrected).",
          }
        }

        const saved = yield* Effect.promise(() =>
          store.remember({
            content: params.content!,
            outcome: params.outcome!,
            container,
            sessionID: ctx.sessionID,
          }),
        )

        if (!saved) {
          return {
            title: "memory remember rejected",
            metadata: {
              available: true,
              backend: status.backend,
              action: "remember",
              saved: false,
            } satisfies Meta,
            output: "Remember rejected (unverified/empty, or backend error). Verified outcomes only.",
          }
        }

        return {
          title: `memory remember ${saved.outcome}`,
          metadata: {
            available: true,
            backend: status.backend,
            action: "remember",
            saved: true,
          } satisfies Meta,
          output: `[grist:memory] saved id=${saved.id} outcome=${saved.outcome} container=${saved.container}\n${saved.content}`,
        }
      }),
  }),
)
