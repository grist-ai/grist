import { describe, expect } from "bun:test"
import path from "path"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTable } from "@opencode/core/session/sql"
import { ConversationRegistry } from "@opencode/core/conversation/registry"
import { initGit } from "./fixture/git"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Project.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      ConversationRegistry.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  ),
)

const withRepo = <A, E, R>(f: (location: Location.Ref) => Effect.Effect<A, E, R>) =>
  tmpdirScoped().pipe(
    Effect.flatMap((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => initGit(tmp.path))
        return yield* f(Location.Ref.make({ directory: AbsolutePath.make(path.resolve(tmp.path)) }))
      }),
    ),
  )

const storedConversation = (sessionID: Session.Info["id"]) =>
  Database.Service.use(({ db }) =>
    db
      .select({ conversation_id: SessionTable.conversation_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie, Effect.map((row) => row?.conversation_id ?? null)),
  )

describe("Session conversation association", () => {
  it.live("records the conversation a session was created in", () =>
    withRepo((location) =>
      Effect.gen(function* () {
        const projects = yield* Project.Service
        const project = yield* projects.resolve(location.directory)
        const conversations = yield* ConversationRegistry.Service
        const conversation = yield* conversations.create({ projectID: project.id, title: "linked" })
        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location, conversationID: conversation.id })
        expect(created.conversationID).toBe(conversation.id)
        expect((yield* sessions.get(created.id)).conversationID).toBe(conversation.id)
        expect(yield* storedConversation(created.id)).toBe(conversation.id)
      }),
    ),
  )

  it.live("untargeted sessions record no conversation", () =>
    withRepo((location) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location })
        expect(created.conversationID).toBeUndefined()
        expect((yield* sessions.get(created.id)).conversationID).toBeUndefined()
        // The stored shape of every pre-conversation session: NULL, with no
        // migration rewrite of historical rows.
        expect(yield* storedConversation(created.id)).toBeNull()
      }),
    ),
  )

  it.live("children inherit the parent conversation; an explicit conversation wins", () =>
    withRepo((location) =>
      Effect.gen(function* () {
        const projects = yield* Project.Service
        const project = yield* projects.resolve(location.directory)
        const conversations = yield* ConversationRegistry.Service
        const parentConversation = yield* conversations.create({ projectID: project.id, title: "parent" })
        const ownConversation = yield* conversations.create({ projectID: project.id, title: "own" })
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ location, conversationID: parentConversation.id })
        const child = yield* sessions.create({ parentID: parent.id })
        expect(child.conversationID).toBe(parentConversation.id)
        const targeted = yield* sessions.create({ parentID: parent.id, conversationID: ownConversation.id })
        expect(targeted.conversationID).toBe(ownConversation.id)
      }),
    ),
  )

  it.live("the registry composes a conversation's sessions in creation order", () =>
    withRepo((location) =>
      Effect.gen(function* () {
        const projects = yield* Project.Service
        const project = yield* projects.resolve(location.directory)
        const conversations = yield* ConversationRegistry.Service
        const conversation = yield* conversations.create({ projectID: project.id, title: "composed" })
        const sessions = yield* Session.Service
        const first = yield* sessions.create({ location, conversationID: conversation.id })
        const second = yield* sessions.create({ location, conversationID: conversation.id })
        yield* sessions.create({ location })
        const fetched = yield* conversations.get(conversation.id)
        expect(fetched?.sessionIDs).toEqual([first.id, second.id])
        const list = yield* conversations.list({ projectID: project.id })
        expect(list.find((entry) => entry.id === conversation.id)?.sessionIDs).toEqual([first.id, second.id])
      }),
    ),
  )
})
