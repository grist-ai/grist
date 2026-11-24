import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { asc, desc, eq } from "drizzle-orm"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Conversation } from "@opencode/schema/conversation"
import { Session } from "@opencode/schema/session"
import { Database } from "../database/database.js"
import { Project } from "../project.js"
import { ProjectTable } from "../project/sql.js"
import { SessionTable, SessionMessageTable } from "../session/sql.js"
import { ConversationTable } from "./sql.js"

export const ID = Conversation.ID
export type ID = typeof ID.Type

export const Info = Conversation.Info
export type Info = typeof Info.Type

export const CreateInput = Conversation.CreateInput
export type CreateInput = typeof CreateInput.Type

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Conversation.NotFoundError", {
  conversationID: Conversation.ID,
}) {}

export type Error = Project.NotFoundError | NotFoundError

/** One stored session message row, in the raw {type, data} shape the thread model projects. */
export type StoredMessage = {
  type: string
  data: Record<string, unknown>
}

export interface Interface {
  /** All conversations for a project, most recently created first, with their session links composed. */
  readonly list: (input: { projectID: Project.ID }) => Effect.Effect<Conversation.List, Project.NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info, Project.NotFoundError>
  /** One conversation by id, with its session links composed; undefined when it does not exist. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Raw stored messages for a session, in seq order — the posted stream's input. */
  readonly messages: (input: { sessionID: Session.ID }) => Effect.Effect<StoredMessage[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ConversationRegistry") {}

type ConversationRow = typeof ConversationTable.$inferSelect

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db

    const project = Effect.fnUntraced(function* (projectID: Project.ID) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get().pipe(Effect.orDie)
      if (!row) return yield* new Project.NotFoundError({ projectID })
      return row
    })

    // The link lives on the session rows; a conversation's session list is
    // composed from them in creation order, never stored on the conversation.
    const sessionIDs = Effect.fnUntraced(function* (conversationID: Conversation.ID) {
      const rows = yield* db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(eq(SessionTable.conversation_id, conversationID))
        .orderBy(asc(SessionTable.time_created), asc(SessionTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => row.id)
    })

    const fromRow = Effect.fnUntraced(function* (row: ConversationRow) {
      return Conversation.Info.make({
        id: Conversation.ID.make(row.id),
        projectID: Project.ID.make(row.project_id),
        title: row.title,
        createdBy: row.created_by ?? undefined,
        status: row.status,
        sessionIDs: yield* sessionIDs(Conversation.ID.make(row.id)),
        time: {
          created: DateTime.makeUnsafe(row.time_created),
          updated: DateTime.makeUnsafe(row.time_updated),
        },
      })
    })

    return Service.of({
      list: Effect.fn("ConversationRegistry.list")(function* (input) {
        yield* project(input.projectID)
        const rows = yield* db
          .select()
          .from(ConversationTable)
          .where(eq(ConversationTable.project_id, input.projectID))
          .orderBy(desc(ConversationTable.time_created), desc(ConversationTable.id))
          .all()
          .pipe(Effect.orDie)
        return yield* Effect.forEach(rows, fromRow)
      }),
      create: Effect.fn("ConversationRegistry.create")(function* (input: CreateInput) {
        yield* project(input.projectID)
        const id = Conversation.ID.create()
        const inserted = yield* db
          .insert(ConversationTable)
          .values({
            id,
            project_id: input.projectID,
            title: input.title ?? "Untitled conversation",
            created_by: input.createdBy,
            status: "active",
          })
          .returning()
          .get()
          .pipe(Effect.orDie)
        return yield* fromRow(inserted)
      }),
      get: Effect.fn("ConversationRegistry.get")(function* (id: ID) {
        const row = yield* db
          .select()
          .from(ConversationTable)
          .where(eq(ConversationTable.id, id))
          .get()
          .pipe(Effect.orDie)
        if (!row) return undefined
        return yield* fromRow(row)
      }),
      messages: Effect.fn("ConversationRegistry.messages")(function* (input: { sessionID: Session.ID }) {
        const rows = yield* db
          .select({ type: SessionMessageTable.type, data: SessionMessageTable.data })
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.session_id, input.sessionID))
          .orderBy(asc(SessionMessageTable.seq))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => ({
          type: row.type,
          data: (row.data ?? {}) as Record<string, unknown>,
        }))
      }),
    })
  }),
)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node],
})

export * as ConversationRegistry from "./registry.js"
