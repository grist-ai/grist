import { optional } from "@opencode/schema/schema"
import { Conversation } from "@opencode/schema/conversation"
import { Environment } from "@opencode/schema/environment"
import { Session } from "@opencode/schema/session"
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

export const GristConversationList = Schema.Struct({
  conversations: Schema.Array(Conversation.Info),
}).annotate({ identifier: "Grist.ConversationList" })

const ConversationCreatePayload = Schema.Struct({
  title: optional(Schema.String),
  createdBy: optional(Schema.String),
})

const ConversationShowParams = Schema.Struct({
  id: Conversation.ID,
}).annotate({ identifier: "Grist.ConversationShowParams" })

/**
 * One item of a conversation's posted stream (spec §5.1): the deliberate
 * subset of the linked sessions' thread items — user messages, assistant
 * results, outcomes, questions, file references, lifecycle notes. Raw tool
 * calls, reasoning, and shell detail never appear here; they stay in the
 * session inspect view.
 */
export const GristPostedItem = Schema.Struct({
  sessionID: Session.ID,
  kind: Schema.Literals(["user", "message", "outcome", "question", "files", "lifecycle"]),
  text: optional(Schema.String),
  status: optional(Schema.Literals(["succeeded", "failed", "interrupted"])),
  files: optional(Schema.Array(Schema.String)),
  event: optional(Schema.String),
  reason: optional(Schema.String),
  rung: optional(Schema.String),
}).annotate({ identifier: "Grist.PostedItem" })

export const GristConversationView = Schema.Struct({
  conversation: Conversation.Info,
  stream: Schema.Array(GristPostedItem),
  memory: Schema.Array(GristMemoryRecord),
}).annotate({ identifier: "Grist.ConversationView" })

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
  .add(
    HttpApiEndpoint.get("grist.conversation.list", "/api/grist/conversations", {
      query: LocationQuery,
      success: GristConversationList,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "grist.conversation.list",
          summary: "List conversations",
          description:
            "All conversations for the requested location's project, most recently created first, with their linked session ids composed from the sessions' conversation links.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("grist.conversation.create", "/api/grist/conversations/create", {
      query: LocationQuery,
      payload: ConversationCreatePayload,
      success: Conversation.Info,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "grist.conversation.create",
          summary: "Create conversation",
          description:
            "Create a conversation (a durable human-facing thread of work) for the requested location's project. Sessions join it by recording its id at creation.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("grist.conversation.show", "/api/grist/conversations/:id", {
      params: ConversationShowParams,
      query: LocationQuery,
      success: GristConversationView,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "grist.conversation.show",
          summary: "Show conversation",
          description:
            "One conversation with its posted stream — derived from the linked sessions via the thread-model classification, never stored — and the memory entries captured in those sessions.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "grist",
      description: "Grist-owned memory and code-map surfaces.",
    }),
  )
