export * as Conversation from "./conversation.js"

import { Schema } from "effect"
import { ConversationID } from "./conversation-id.js"
import { Project } from "./project.js"
import { DateTimeUtcFromMillis, optional } from "./schema.js"
import { SessionID } from "./session-id.js"

export const ID = ConversationID
export type ID = ConversationID

export const Status = Schema.Literals(["active", "done", "archived"]).annotate({ identifier: "Conversation.Status" })
export type Status = typeof Status.Type

/**
 * A conversation is the durable human-facing thread of work (spec §5.1):
 * a goal, the sessions that served it (ordered links; sessions may be
 * sequential or parallel), and a posted stream that is always *derived*
 * from those sessions — never stored here. Conversations live in the
 * harness's local store beside sessions and are never synced (D12).
 * `sessionIDs` is composed from the sessions' `conversation_id` links at
 * read time, so the session rows stay the single source of truth for the
 * link; a session with no link is the degenerate one-session case and
 * belongs to no stored conversation.
 */
export const Info = Schema.Struct({
  id: ID,
  projectID: Project.ID,
  /** The goal, in human-readable words. */
  title: Schema.String,
  /** Who started the conversation (account identity), when known. */
  createdBy: optional(Schema.String),
  status: Status,
  /** Linked sessions in link order (session creation order). */
  sessionIDs: Schema.Array(SessionID),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
  }),
}).annotate({ identifier: "Conversation.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const CreateInput = Schema.Struct({
  projectID: Project.ID,
  title: optional(Schema.String),
  createdBy: optional(Schema.String),
}).annotate({ identifier: "Conversation.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

export const List = Schema.Array(Info).annotate({ identifier: "Conversation.List" })
export type List = typeof List.Type
