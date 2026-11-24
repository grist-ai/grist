import { describe, expect } from "bun:test"
import fs from "fs/promises"
import { chmodSync, existsSync, mkdtempSync, symlinkSync, writeFileSync } from "fs"
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
import { Worktree } from "@opencode/core/worktree"
import { WorktreeTable } from "@opencode/core/worktree/sql"
import { EnvironmentRegistry } from "@opencode/core/environment/registry"
import { Environment } from "@opencode/schema/environment"
import { initRepo } from "./fixture/git"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const data = mkdtempSync(path.join(os.tmpdir(), "opencode-env-sandbox-registry-"))

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
  const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
  if (!error) return undefined
  return (error as { _tag: string })._tag
}

/** Run an effect with process.env.PATH replaced; restored on success and failure alike (acquireUseRelease — a generator finally does not run when a yielded effect fails). */
const withPath = <A, E, R>(value: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const original = process.env.PATH
      process.env.PATH = value
      return original
    }),
    () => effect,
    (original) =>
      Effect.sync(() => {
        process.env.PATH = original
      }),
  )

/** A PATH directory whose bwrap/socat stubs exit 0 (tooling present, probe passes), with the real git linked in — the Worktree engine still needs it. */
const stubToolBin = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "opencode-stub-tools-"))
  for (const name of ["bwrap", "socat"]) {
    const file = path.join(dir, name)
    writeFileSync(file, "#!/bin/sh\nexit 0\n")
    chmodSync(file, 0o755)
  }
  for (const dirPath of (process.env.PATH ?? "").split(path.delimiter)) {
    const git = path.join(dirPath, "git")
    if (!existsSync(git)) continue
    symlinkSync(git, path.join(dir, "git"))
    break
  }
  return dir
}

describe("EnvironmentRegistry sandbox environments", () => {
  it.live("creation is refused when the jail tooling cannot be found (fail closed)", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* EnvironmentRegistry.Service
      const emptyBin = mkdtempSync(path.join(os.tmpdir(), "opencode-empty-bin-"))
      const exit = yield* Effect.exit(
        withPath(
          emptyBin,
          registry.create({ projectID, name: Environment.Name.make("jailed"), kind: "sandbox" }),
        ),
      )
      expect(failureTag(exit)).toBe("Environment.SandboxUnavailableError")
    }),
  )

  it.live("creation provisions the worktree and records the policy where tooling works", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* EnvironmentRegistry.Service
      // The success path is Linux-shaped (bwrap tooling stubs); elsewhere the
      // machine's real backend decides, and the refusal is equally valid.
      const created = yield* Effect.exit(
        withPath(
          process.platform === "linux" ? stubToolBin() : (process.env.PATH ?? ""),
          registry.create({ projectID, name: Environment.Name.make("vault"), kind: "sandbox" }),
        ),
      )
      if (Exit.isFailure(created)) {
        expect(failureTag(created)).toBe("Environment.SandboxUnavailableError")
        return
      }
      const environment = created.value
      expect(environment.kind).toBe("sandbox")
      expect(environment.branch).toMatch(/^grist\/vault-/)
      expect(environment.directory).toBeTruthy()
      const stat = yield* Effect.promise(() => fs.stat(environment.directory!))
      expect(stat.isDirectory()).toBe(true)
      expect(environment.policy).toBeDefined()
      expect(environment.policy!.backend).toBe(process.platform === "darwin" ? "sandbox-exec" : "bwrap")
      expect(environment.policy!.filesystem.status).toBe("full")
      // The recorded policy lives in the worktree's sandbox scratch.
      const recorded = JSON.parse(
        yield* Effect.promise(() =>
          fs.readFile(path.join(environment.directory!, ".grist", "sandbox", "policy.json"), "utf8"),
        ),
      ) as { backend: string; egressAllowlist: Array<string> }
      expect(recorded.backend).toBe(environment.policy!.backend)
      expect(recorded.egressAllowlist).toContain("registry.npmjs.org")
      const scratchHome = yield* Effect.promise(() =>
        fs.stat(path.join(environment.directory!, ".grist", "sandbox", "home")),
      )
      expect(scratchHome.isDirectory()).toBe(true)
      // And the registry lists it back with the summary attached.
      const listed = yield* registry.list({ projectID })
      const found = listed.find((entry) => entry.id === environment.id)
      expect(found?.policy).toBeDefined()
    }),
  )

  it.live("removing a sandbox environment clears its own scratch first, so a used sandbox stays removable", () =>
    Effect.gen(function* () {
      const { projectID } = yield* setup()
      const registry = yield* EnvironmentRegistry.Service
      const created = yield* Effect.exit(
        withPath(
          process.platform === "linux" ? stubToolBin() : (process.env.PATH ?? ""),
          registry.create({ projectID, name: Environment.Name.make("vault"), kind: "sandbox" }),
        ),
      )
      if (Exit.isFailure(created)) {
        expect(failureTag(created)).toBe("Environment.SandboxUnavailableError")
        return
      }
      // Creation already recorded scratch (policy.json) inside the worktree;
      // without scratch clearing, the worktree engine would refuse removal
      // over the sandbox's own bookkeeping.
      yield* registry.remove({ projectID, name: Environment.Name.make("vault"), force: false })
      const listed = yield* registry.list({ projectID })
      expect(listed.map((entry) => entry.name)).toEqual(["local"])
    }),
  )
})
