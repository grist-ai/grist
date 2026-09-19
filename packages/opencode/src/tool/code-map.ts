import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./code-map.txt"
import { createProvider, formatSubgraph } from "@/grist/code-map"
import { InstanceState } from "@/effect/instance-state"
import { PositiveInt } from "@opencode-ai/core/schema"

export const Parameters = Schema.Struct({
  seed: Schema.String.annotate({
    description: "File path, symbol name, or node id to center the subgraph on",
  }),
  hops: Schema.optional(PositiveInt).annotate({
    description: "Graph walk depth (default 2)",
  }),
  maxNodes: Schema.optional(PositiveInt).annotate({
    description: "Soft cap on nodes returned (default 40)",
  }),
})

export const CodeMapTool = Tool.define(
  "code_map",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        type Meta = {
          available: boolean
          provider?: string
          detail?: string
          hit?: boolean
          nodes?: number
          edges?: number
          graphPath?: string
        }

        if (process.env.GRIST_CODE_MAP === "off") {
          const metadata: Meta = { available: false }
          return {
            title: "code_map disabled",
            metadata,
            output: "code_map is disabled (GRIST_CODE_MAP=off).",
          }
        }

        const instance = yield* InstanceState.context
        const provider = createProvider({ cwd: instance.directory })
        if (!provider) {
          const metadata: Meta = { available: false }
          return {
            title: "code_map unavailable",
            metadata,
            output: "No code-map provider selected.",
          }
        }

        const status = yield* Effect.promise(() => provider.status())
        if (!status.available) {
          const metadata: Meta = {
            available: false,
            provider: provider.id,
            detail: status.detail,
          }
          return {
            title: `code_map ${provider.id} unavailable`,
            metadata,
            output: [
              `[grist:code-map] provider=${provider.id} unavailable`,
              status.detail,
              "",
              "Build a Graphify graph (AST-only, no API) into graphify-out/graph.json,",
              "or set GRIST_GRAPHIFY_PATH. For CRG, wire MCP and set GRIST_CRG=1 / GRIST_CODE_MAP=crg.",
              "See docs/code-map.md.",
            ].join("\n"),
          }
        }

        const subgraph = yield* Effect.promise(() =>
          provider.subgraph({
            seed: params.seed,
            hops: params.hops,
            maxNodes: params.maxNodes,
          }),
        )

        if (!subgraph) {
          const metadata: Meta = {
            available: true,
            provider: provider.id,
            hit: false,
            graphPath: status.graphPath,
          }
          return {
            title: `code_map miss ${params.seed}`,
            metadata,
            output: `[grist:code-map] no nodes matched seed=${params.seed} (provider=${provider.id})`,
          }
        }

        const metadata: Meta = {
          available: true,
          provider: provider.id,
          hit: true,
          nodes: subgraph.nodes.length,
          edges: subgraph.edges.length,
          graphPath: status.graphPath,
        }
        return {
          title: `code_map ${params.seed}`,
          metadata,
          output: formatSubgraph(subgraph),
        }
      }),
  }),
)
