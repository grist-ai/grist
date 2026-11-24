import { describe, expect } from "bun:test"
import fs from "fs/promises"
import { mkdtempSync } from "fs"
import os from "os"
import path from "path"
import { Cause, Effect, Exit, Option } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/core/schema"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { ConversationRegistry } from "@opencode/core/conversation/registry"
import { Conversation } from "@opencode/schema/conversation"
import { initRepo } from "./fixture/git"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const data = mkdtempSync(path.join(os.tmpdir(), "opencode-conversation-registry-"))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Project.node, ConversationRegistry.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
    Global.node.replace(Global.layerWith({ data })),
    offlineModels,
  ]),
)

const setup = Effect.fnUntraced(function* () {
  const tmp = yield* tmpdirScoped()
  yield* Effect.promise(() => initRepo(tmp.path))
  const directory = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(tmp.path)))
  const projects = yield* Project.Service
  const resolved = yield* projects.resolve(directory)
  return { directory, projectID: resolved.id }
})

const failureTag = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return undefined
  const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
  if (!error) return undefined
  return (error as { _tag: string })._tag
}

describe("ConversationRegistry", () => {
  it.live("creates a conversation with defaults and reads it back", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* ConversationRegistry.Service
      const created = yield* registry.create({ projectID })
      expect(created.id.startsWith("conv_")).toBe(true)
      expect(created.title).toBe("Untitled conversation")
      expect(created.status).toBe("active")
      expect(created.sessionIDs).toEqual([])
      const fetched = yield* registry.get(created.id)
      expect(fetched).toEqual(created)
    }),
  )

  it.live("keeps an explicit title and creator", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* ConversationRegistry.Service
      const created = yield* registry.create({ projectID, title: "Fix the flaky test", createdBy: "cli" })
      expect(created.title).toBe("Fix the flaky test")
      expect(created.createdBy).toBe("cli")
    }),
  )

  it.live("lists conversations most recently created first", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* ConversationRegistry.Service
      const first = yield* registry.create({ projectID, title: "first" })
      const second = yield* registry.create({ projectID, title: "second" })
      const list = yield* registry.list({ projectID })
      expect(list.map((conversation) => conversation.id)).toEqual([second.id, first.id])
    }),
  )

  it.live("get returns undefined for an unknown conversation", () =>
    Effect.gen(function* () {
      yield* setup()
      const registry = yield* ConversationRegistry.Service
      expect(yield* registry.get(Conversation.ID.make("conv_00000000000000000000000000"))).toBeUndefined()
    }),
  )

  it.live("create in an unknown project fails with Project.NotFoundError", () =>
    Effect.gen(function* () {
      yield* setup()
      const registry = yield* ConversationRegistry.Service
      const exit = yield* Effect.exit(
        registry.create({ projectID: Project.ID.make("prj_00000000000000000000000000") }),
      )
      expect(failureTag(exit)).toBe("Project.NotFoundError")
    }),
  )
})
