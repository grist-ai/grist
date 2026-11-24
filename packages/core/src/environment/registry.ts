import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { and, asc, eq } from "drizzle-orm"
import { hostname } from "node:os"
import path from "node:path"
import { FSUtil } from "@opencode/util/fs-util"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Environment } from "@opencode/schema/environment"
import { Database } from "../database/database.js"
import { AbsolutePath } from "../schema.js"
import { Project } from "../project.js"
import { ProjectTable } from "../project/sql.js"
import { Worktree } from "../worktree.js"
import { EnvironmentTable } from "./sql.js"

export const ID = Environment.ID
export type ID = typeof ID.Type

export const Info = Environment.Info
export type Info = typeof Info.Type

export const CreateInput = Environment.CreateInput
export type CreateInput = typeof CreateInput.Type

export const RemoveInput = Environment.RemoveInput
export type RemoveInput = typeof RemoveInput.Type

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Environment.NotFoundError", {
  projectID: Project.ID,
  name: Schema.String,
}) {}

export class NameTakenError extends Schema.TaggedError<NameTakenError>()("Environment.NameTakenError", {
  projectID: Project.ID,
  name: Schema.String,
}) {}

export class LocalImmutableError extends Schema.TaggedError<LocalImmutableError>()(
  "Environment.LocalImmutableError",
  { operation: Schema.Literals(["create", "remove"]) },
) {}

export class SandboxUnavailableError extends Schema.TaggedError<SandboxUnavailableError>()(
  "Environment.SandboxUnavailableError",
  {},
) {}

export type Error =
  | Project.NotFoundError
  | NotFoundError
  | NameTakenError
  | LocalImmutableError
  | SandboxUnavailableError
  | Worktree.Error

export interface Interface {
  /** All environments for a project: environment zero (local) first, then stored environments by creation time. */
  readonly list: (input: { projectID: Project.ID }) => Effect.Effect<Environment.List, Project.NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info, Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<void, Error>
  /** Resolve a user-typed name (including `local`) to an environment record. */
  readonly resolve: (
    input: { projectID: Project.ID; name: string },
  ) => Effect.Effect<Info, Project.NotFoundError | NotFoundError>
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Record that a session started in this environment. No-op for environment zero. */
  readonly touch: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EnvironmentRegistry") {}

type ProjectRow = typeof ProjectTable.$inferSelect
type EnvironmentRow = typeof EnvironmentTable.$inferSelect

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const database = yield* Database.Service
    const db = database.db
    const worktrees = yield* Worktree.Service

    const project = Effect.fnUntraced(function* (projectID: Project.ID) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get().pipe(Effect.orDie)
      if (!row) return yield* new Project.NotFoundError({ projectID })
      return row
    })

    // Environment zero is implicit: synthesized from the project row, never stored,
    // never created or removed by hand. Sessions reference it by recording no
    // environment_id (null), not by pointing at this record's id.
    const local = (row: ProjectRow): Info =>
      Environment.Info.make({
        id: Environment.LOCAL_ENVIRONMENT_ID,
        projectID: Project.ID.make(row.id),
        name: "local",
        kind: "local",
        directory: AbsolutePath.make(row.worktree),
        machine: hostname(),
        status: "active",
        time: {
          created: DateTime.makeUnsafe(row.time_created),
          updated: DateTime.makeUnsafe(row.time_updated),
        },
      })

    const fromRow = Effect.fnUntraced(function* (row: EnvironmentRow) {
      const exists = row.directory ? yield* fs.isDir(AbsolutePath.make(row.directory)) : false
      return Environment.Info.make({
        id: Environment.ID.make(row.id),
        projectID: Project.ID.make(row.project_id),
        name: row.name,
        kind: row.kind,
        directory: row.directory ? AbsolutePath.make(row.directory) : undefined,
        branch: row.branch ?? undefined,
        machine: row.machine ?? undefined,
        status: exists ? "active" : "missing",
        time: {
          created: DateTime.makeUnsafe(row.time_created),
          updated: DateTime.makeUnsafe(row.time_updated),
          used: row.time_used === null ? undefined : DateTime.makeUnsafe(row.time_used),
        },
      })
    })

    const stored = Effect.fnUntraced(function* (projectID: Project.ID) {
      return yield* db
        .select()
        .from(EnvironmentTable)
        .where(eq(EnvironmentTable.project_id, projectID))
        .orderBy(asc(EnvironmentTable.time_created), asc(EnvironmentTable.name))
        .all()
        .pipe(Effect.orDie)
    })

    const find = Effect.fnUntraced(function* (projectID: Project.ID, name: string) {
      // Stored names are always valid slugs (creation enforces the Name schema);
      // anything else cannot exist, and must not reach the branded constructor.
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name.length > 48) return undefined
      return yield* db
        .select()
        .from(EnvironmentTable)
        .where(and(eq(EnvironmentTable.project_id, projectID), eq(EnvironmentTable.name, Environment.Name.make(name))))
        .get()
        .pipe(Effect.orDie)
    })

    const resolve = Effect.fn("EnvironmentRegistry.resolve")(function* (input: {
      projectID: Project.ID
      name: string
    }) {
      const row = yield* project(input.projectID)
      if (input.name === "local") return local(row)
      const found = yield* find(input.projectID, input.name)
      if (!found) return yield* new NotFoundError({ projectID: input.projectID, name: input.name })
      return yield* fromRow(found)
    })

    return Service.of({
      list: Effect.fn("EnvironmentRegistry.list")(function* (input) {
        const row = yield* project(input.projectID)
        const rows = yield* stored(input.projectID)
        const infos = yield* Effect.forEach(rows, fromRow)
        return [local(row), ...infos]
      }),
      create: Effect.fn("EnvironmentRegistry.create")(function* (input: CreateInput) {
        yield* project(input.projectID)
        if (input.kind === "local") return yield* new LocalImmutableError({ operation: "create" })
        if (input.name === "local") return yield* new NameTakenError({ projectID: input.projectID, name: input.name })
        if (input.kind === "sandbox") return yield* new SandboxUnavailableError()
        if (yield* find(input.projectID, input.name))
          return yield* new NameTakenError({ projectID: input.projectID, name: input.name })
        const id = Environment.ID.create()
        const short = id.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase()
        const branch = `grist/${input.name}-${short}`
        const created = yield* worktrees.create({ projectID: input.projectID, name: input.name, newBranch: branch })
        // Per-environment `.grist/` state dir (memory journal, sync state), as in the main checkout.
        yield* fs
          .makeDirectory(AbsolutePath.make(path.join(created.directory, ".grist")), { recursive: true })
          .pipe(Effect.orDie)
        const inserted = yield* db
          .insert(EnvironmentTable)
          .values({
            id,
            project_id: input.projectID,
            name: input.name,
            kind: input.kind,
            directory: created.directory,
            branch,
            machine: hostname(),
          })
          .onConflictDoNothing()
          .returning({ id: EnvironmentTable.id })
          .get()
          .pipe(Effect.orDie)
        if (!inserted) {
          yield* worktrees
            .remove({ projectID: input.projectID, directory: created.directory, force: true })
            .pipe(Effect.ignore)
          return yield* new NameTakenError({ projectID: input.projectID, name: input.name })
        }
        const row = yield* find(input.projectID, input.name)
        if (!row) return yield* Effect.die(new Error(`Environment row missing after insert: ${id}`))
        return yield* fromRow(row)
      }),
      remove: Effect.fn("EnvironmentRegistry.remove")(function* (input: RemoveInput) {
        yield* project(input.projectID)
        if (input.name === "local") return yield* new LocalImmutableError({ operation: "remove" })
        const row = yield* find(input.projectID, input.name)
        if (!row) return yield* new NotFoundError({ projectID: input.projectID, name: input.name })
        if (row.directory)
          yield* worktrees.remove({ projectID: input.projectID, directory: AbsolutePath.make(row.directory), force: input.force })
        yield* db
          .delete(EnvironmentTable)
          .where(eq(EnvironmentTable.id, row.id))
          .run()
          .pipe(Effect.orDie)
      }),
      resolve,
      get: Effect.fn("EnvironmentRegistry.get")(function* (id: ID) {
        if (id === Environment.LOCAL_ENVIRONMENT_ID) return undefined
        const row = yield* db
          .select()
          .from(EnvironmentTable)
          .where(eq(EnvironmentTable.id, id))
          .get()
          .pipe(Effect.orDie)
        if (!row) return undefined
        return yield* fromRow(row)
      }),
      touch: Effect.fn("EnvironmentRegistry.touch")(function* (id: ID) {
        if (id === Environment.LOCAL_ENVIRONMENT_ID) return
        yield* db
          .update(EnvironmentTable)
          .set({ time_used: Date.now() })
          .where(eq(EnvironmentTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
    })
  }),
)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Database.node, Worktree.node],
})

export * as EnvironmentRegistry from "./registry.js"
