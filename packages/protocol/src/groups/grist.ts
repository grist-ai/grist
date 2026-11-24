import { optional } from "@opencode/schema/schema"
import { Environment } from "@opencode/schema/environment"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location.js"
import { InvalidRequestError } from "../errors.js"

/**
 * Grist-owned surfaces (D5): the per-project memory store and code map,
 * exposed read/write over the same location-scoped API as everything
 * else. Memory records mirror @grist-ai/logic's MemoryRecord — the
 * file store under `<directory>/.grist/memory.json` is the source of
 * truth for the local backend.
 */
export const GristMemoryRecord = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  container: Schema.String,
  outcome: Schema.Literals(["tests_passed", "user_approved", "user_corrected", "check_failed"]),
  weight: Schema.Number,
  createdAt: Schema.Number,
  sessionID: optional(Schema.String),
  metadata: optional(Schema.Record(Schema.String, Schema.String)),
}).annotate({ identifier: "Grist.MemoryRecord" })

export const GristMemoryList = Schema.Struct({
  backend: Schema.String,
  records: Schema.Array(GristMemoryRecord),
}).annotate({ identifier: "Grist.MemoryList" })

export const GristCodeMapSummary = Schema.Struct({
  available: Schema.Boolean,
  detail: Schema.String,
  nodes: Schema.Number,
  edges: Schema.Number,
  top: Schema.Array(
    Schema.Struct({ id: Schema.String, label: Schema.String, degree: Schema.Number }),
  ),
}).annotate({ identifier: "Grist.CodeMapSummary" })

const ForgetPayload = Schema.Struct({
  id: Schema.String,
})

export const GristEnvironmentList = Schema.Struct({
  environments: Schema.Array(Environment.Info),
}).annotate({ identifier: "Grist.EnvironmentList" })

const EnvironmentCreatePayload = Schema.Struct({
  name: Environment.Name,
  kind: Environment.Kind,
})

const EnvironmentRemovePayload = Schema.Struct({
  name: Environment.Name,
  force: optional(Schema.Boolean),
})

export const GristGroup = HttpApiGroup.make("server.grist")
  .add(
    HttpApiEndpoint.get("grist.memory.list", "/api/grist/memory", {
      query: LocationQuery,
      success: GristMemoryList,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "grist.memory.list",
          summary: "List memory records",
          description:
            "All verified-outcome memory records stored for the requested location's project, newest first (the D5 memory browser).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("grist.memory.forget", "/api/grist/memory/forget", {
      query: LocationQuery,
      payload: ForgetPayload,
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "grist.memory.forget",
          summary: "Forget a memory record",
          description: "Delete one memory record by id from the requested location's project store.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("grist.codeMap.get", "/api/grist/code-map", {
      query: LocationQuery,
      success: GristCodeMapSummary,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "grist.codeMap.get",
          summary: "Code map summary",
          description:
            "Whole-graph summary of the requested location's code map (Graphify graph): availability, node/edge counts, and the most-connected landmark nodes.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("grist.environment.list", "/api/grist/environments", {
      query: LocationQuery,
      success: GristEnvironmentList,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "grist.environment.list",
          summary: "List environments",
          description:
            "All environments for the requested location's project: the implicit local environment first, then stored worktree environments.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("grist.environment.create", "/api/grist/environments/create", {
      query: LocationQuery,
      payload: EnvironmentCreatePayload,
      success: Environment.Info,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "grist.environment.create",
          summary: "Create environment",
          description:
            "Create a worktree environment for the requested location's project: a git worktree on a grist/<name>-<id> branch with its own .grist state directory. The local environment is implicit and cannot be created; the sandbox kind is not yet available.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("grist.environment.remove", "/api/grist/environments/remove", {
      query: LocationQuery,
      payload: EnvironmentRemovePayload,
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "grist.environment.remove",
          summary: "Remove environment",
          description:
            "Remove a worktree environment and its git worktree. The local environment cannot be removed.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "grist",
      description: "Grist-owned memory and code-map surfaces.",
    }),
  )
