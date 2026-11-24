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
import { Environment } from "@opencode/schema/environment"
import { initGit } from "./fixture/git"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Project.node, SessionProjector.node, SessionStore.node, Session.node]),
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

const storedEnvironment = (sessionID: Session.Info["id"]) =>
  Database.Service.use(({ db }) =>
    db
      .select({ environment_id: SessionTable.environment_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie, Effect.map((row) => row?.environment_id ?? null)),
  )

describe("Session environment association", () => {
  it.live("records the environment a session was created in", () =>
    withRepo((location) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const environmentID = Environment.ID.create()
        const created = yield* sessions.create({ location, environmentID })
        expect(created.environmentID).toBe(environmentID)
        expect((yield* sessions.get(created.id)).environmentID).toBe(environmentID)
        expect(yield* storedEnvironment(created.id)).toBe(environmentID)
      }),
    ),
  )

  it.live("untargeted sessions record no environment and read as local", () =>
    withRepo((location) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location })
        expect(created.environmentID).toBeUndefined()
        expect((yield* sessions.get(created.id)).environmentID).toBeUndefined()
        // The stored shape of every pre-registry session: NULL reads back as
        // environment zero, with no migration rewrite of historical rows.
        expect(yield* storedEnvironment(created.id)).toBeNull()
      }),
    ),
  )

  it.live("children inherit the parent environment; an explicit environment wins", () =>
    withRepo((location) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const parentEnvironment = Environment.ID.create()
        const parent = yield* sessions.create({ location, environmentID: parentEnvironment })
        const child = yield* sessions.create({ parentID: parent.id })
        expect(child.environmentID).toBe(parentEnvironment)

        const ownEnvironment = Environment.ID.create()
        const targeted = yield* sessions.create({ parentID: parent.id, environmentID: ownEnvironment })
        expect(targeted.environmentID).toBe(ownEnvironment)
      }),
    ),
  )
})
