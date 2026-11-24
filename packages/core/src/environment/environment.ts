import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import path from "node:path"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import type { Files } from "./files.js"
import { makeFiles } from "./index.js"
import { makeLocalDriver } from "./local.js"
import { Sandbox } from "./sandbox.js"
import { EnvironmentTable } from "./sql.js"
import { Database } from "../database/database.js"
import { Location } from "../location.js"
import { Workspace } from "../workspace.js"

export interface Interface {
  readonly files: Files
  readonly spawner: ChildProcessSpawner["Service"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environment") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const location = yield* Location.Service
    const workspace = yield* Workspace.Service
    const driver = location.workspaceID
      ? yield* workspace.connect(location.workspaceID).pipe(
          // Environment has no error channel; an unknown or destroyed placement is a configuration defect by design.
          Effect.mapError(
            (cause) => new Error(`Failed to bind Environment to workspace ${location.workspaceID}`, { cause }),
          ),
          Effect.orDie,
        )
      : yield* localDriver(spawner, location)
    return Service.of({ files: makeFiles(driver), spawner: driver.spawner })
  }),
)

/**
 * The local placement's driver: the sandbox driver when this location is
 * a sandbox environment's worktree (or inside it), the plain local driver
 * otherwise. Selection is by environment record and directory — a session
 * targeted at a sandbox environment lands in its worktree directory,
 * which is what names the jail. Local and worktree sessions are
 * untouched.
 *
 * The record read goes straight to the environment table (the registry's
 * storage) rather than the registry service: the registry's full service
 * graph (worktree engine, project resolution) is far heavier than this
 * location-scoped layer may pull in. The read is also best-effort —
 * locations exist for projects with no environment records at all
 * (ad-hoc directories, the global project), and those are plain local
 * placements by definition. A sandbox session cannot be one of them:
 * creating it required the record. When a record DOES match, the jail
 * itself fails closed — an unavailable backend makes the driver refuse
 * every spawn rather than fall back.
 */
const localDriver = Effect.fnUntraced(function* (
  spawner: ChildProcessSpawner["Service"],
  location: Location.Interface,
) {
  const { db } = yield* Database.Service
  const rows = yield* db
    .select()
    .from(EnvironmentTable)
    .where(eq(EnvironmentTable.project_id, location.project.id))
    .all()
    .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
  const directory = path.resolve(location.directory)
  const match = rows?.find(
    (row) =>
      row.kind === "sandbox" &&
      row.directory !== null &&
      (directory === path.resolve(row.directory) || directory.startsWith(path.resolve(row.directory) + path.sep)),
  )
  if (!match?.directory) return makeLocalDriver(spawner)
  const capability = yield* Sandbox.capability(process.env)
  return Sandbox.makeSandboxDriver({
    spawner,
    policy: Sandbox.policyFor({ directory: match.directory }),
    capability,
  })
})

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [CrossSpawnSpawner.node, Location.node, Workspace.node, Database.node],
})

export * as EnvironmentService from "./environment.js"
