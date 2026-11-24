import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import { mkdtempSync } from "fs"
import os from "os"
import path from "path"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/core/schema"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { Worktree } from "@opencode/core/worktree"
import { WorktreeTable } from "@opencode/core/worktree/sql"
import { EnvironmentRegistry } from "@opencode/core/environment/registry"
import { Environment } from "@opencode/schema/environment"
import { initRepo } from "./fixture/git"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const data = mkdtempSync(path.join(os.tmpdir(), "opencode-env-registry-"))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Project.node, Worktree.node, EnvironmentRegistry.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Global.node.replace(Global.layerWith({ data })),
      offlineModels,
    ],
  ),
)

const setup = Effect.fnUntraced(function* () {
  const tmp = yield* tmpdirScoped()
  yield* Effect.promise(() => initRepo(tmp.path))
  const directory = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(tmp.path)))
  const projects = yield* Project.Service
  const resolved = yield* projects.resolve(directory)
  // Project resolution does not guarantee the worktree inventory root row in
  // every path; the Worktree engine requires it as a creation source.
  const { db } = yield* Database.Service
  yield* db
    .insert(WorktreeTable)
    .values({ project_id: resolved.id, directory })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  return { directory, projectID: resolved.id }
})

const failureTag = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return undefined
  return Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag
}

describe("EnvironmentRegistry", () => {
  it.live("list returns the implicit local environment first", () =>
    Effect.gen(function* () {
      const { directory, projectID } = yield* setup()
      const registry = yield* EnvironmentRegistry.Service
      const list = yield* registry.list({ projectID })
      expect(list).toHaveLength(1)
      expect(list[0]?.kind).toBe("local")
      expect(list[0]?.name).toBe("local")
      expect(list[0]?.id).toBe(Environment.LOCAL_ENVIRONMENT_ID)
      expect(list[0]?.directory).toBe(directory)
      expect(list[0]?.status).toBe("active")
    }),
  )

  it.live("creates a worktree environment on its own branch with a .grist state dir", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* EnvironmentRegistry.Service
      const created = yield* registry.create({
        projectID,
        name: Environment.Name.make("alpha"),
        kind: "worktree",
      })
      expect(created.kind).toBe("worktree")
      expect(created.branch).toMatch(/^grist\/alpha-[a-z0-9]{6}$/)
      expect(created.status).toBe("active")
      if (!created.directory || !created.branch) throw new Error("worktree environment must record directory and branch")
      const stat = yield* Effect.promise(() => fs.stat(created.directory!))
      expect(stat.isDirectory()).toBe(true)
      const stateDir = yield* Effect.promise(() => fs.stat(path.join(created.directory!, ".grist")))
      expect(stateDir.isDirectory()).toBe(true)
      const current = yield* Effect.promise(() => $`git branch --show-current`.cwd(created.directory!).text())
      expect(current.trim()).toBe(created.branch)

      const list = yield* registry.list({ projectID })
      expect(list.map((env) => env.name)).toEqual(["local", "alpha"])
      const resolved = yield* registry.resolve({ projectID, name: "alpha" })
      expect(resolved.id).toBe(created.id)
      const local = yield* registry.resolve({ projectID, name: "local" })
      expect(local.kind).toBe("local")
    }),
  )

  it.live("rejects duplicate names, the local environment, and the sandbox kind", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* EnvironmentRegistry.Service
      yield* registry.create({ projectID, name: Environment.Name.make("beta"), kind: "worktree" })

      const duplicate = yield* Effect.exit(
        registry.create({ projectID, name: Environment.Name.make("beta"), kind: "worktree" }),
      )
      expect(failureTag(duplicate)).toBe("Environment.NameTakenError")

      const reserved = yield* Effect.exit(
        registry.create({ projectID, name: Environment.Name.make("local"), kind: "worktree" }),
      )
      expect(failureTag(reserved)).toBe("Environment.NameTakenError")

      const local = yield* Effect.exit(
        registry.create({ projectID, name: Environment.Name.make("zero"), kind: "local" }),
      )
      expect(failureTag(local)).toBe("Environment.LocalImmutableError")

      const sandbox = yield* Effect.exit(
        registry.create({ projectID, name: Environment.Name.make("jailed"), kind: "sandbox" }),
      )
      expect(failureTag(sandbox)).toBe("Environment.SandboxUnavailableError")
    }),
  )

  it.live("remove deletes the worktree and the record; local and unknown names fail", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* EnvironmentRegistry.Service
      const created = yield* registry.create({
        projectID,
        name: Environment.Name.make("gamma"),
        kind: "worktree",
      })
      yield* registry.remove({ projectID, name: Environment.Name.make("gamma"), force: false })
      const exists = yield* Effect.promise(() => fs.stat(created.directory!).then(() => true, () => false))
      expect(exists).toBe(false)
      expect(yield* registry.list({ projectID })).toHaveLength(1)

      const gone = yield* Effect.exit(registry.resolve({ projectID, name: "gamma" }))
      expect(failureTag(gone)).toBe("Environment.NotFoundError")

      const local = yield* Effect.exit(
        registry.remove({ projectID, name: Environment.Name.make("local"), force: false }),
      )
      expect(failureTag(local)).toBe("Environment.LocalImmutableError")

      const unknown = yield* Effect.exit(
        registry.remove({ projectID, name: Environment.Name.make("nope"), force: false }),
      )
      expect(failureTag(unknown)).toBe("Environment.NotFoundError")
    }),
  )

  it.live("reports a worktree environment as missing once its directory is gone", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* EnvironmentRegistry.Service
      const created = yield* registry.create({
        projectID,
        name: Environment.Name.make("delta"),
        kind: "worktree",
      })
      yield* Effect.promise(() => fs.rm(created.directory!, { recursive: true, force: true }))
      const list = yield* registry.list({ projectID })
      expect(list.find((env) => env.name === "delta")?.status).toBe("missing")
    }),
  )

  it.live("touch records last use; get finds stored environments only", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* EnvironmentRegistry.Service
      const created = yield* registry.create({
        projectID,
        name: Environment.Name.make("epsilon"),
        kind: "worktree",
      })
      expect((yield* registry.get(created.id))?.time.used).toBeUndefined()
      yield* registry.touch(created.id)
      expect((yield* registry.get(created.id))?.time.used).toBeDefined()
      expect(yield* registry.get(Environment.LOCAL_ENVIRONMENT_ID)).toBeUndefined()
      expect(yield* registry.get(Environment.ID.make("env_unknown"))).toBeUndefined()
    }),
  )
})
