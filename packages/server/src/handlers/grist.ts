import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { EnvironmentRegistry } from "@opencode/core/environment/registry"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { createFileStore, createGraphifyProvider, loadGraphifyDocument, summarizeGraph } from "@grist-ai/logic"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { readFile } from "node:fs/promises"
import { Api } from "../api"

/**
 * D5 — Grist surfaces over the location's project: the memory store
 * (file backend; `<project>/.grist/memory.json` is the source of truth)
 * and the code map (Graphify graph at `<project>/graphify-out/`).
 */
export const GristHandler = HttpApiBuilder.group(Api, "server.grist", (handlers) =>
  Effect.gen(function* () {
    const environments = yield* EnvironmentRegistry.Service
    return handlers
      .handle("grist.environment.list", () =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          const list = yield* environments
            .list({ projectID: location.project.id })
            .pipe(Effect.mapError(environmentError))
          return { environments: list }
        }),
      )
      .handle("grist.environment.create", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* environments
            .create({ projectID: location.project.id, name: ctx.payload.name, kind: ctx.payload.kind })
            .pipe(Effect.mapError(environmentError))
        }),
      )
      .handle("grist.environment.remove", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          yield* environments
            .remove({ projectID: location.project.id, name: ctx.payload.name, force: ctx.payload.force ?? false })
            .pipe(Effect.mapError(environmentError))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("grist.memory.list", () =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          const store = createFileStore({ cwd: location.project.directory })
          const status = yield* Effect.promise(() => store.status())
          const records = yield* Effect.promise(() => store.list!())
          return { backend: status.backend, records }
        }),
      )
      .handle("grist.memory.forget", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          const store = createFileStore({ cwd: location.project.directory })
          const removed = yield* Effect.promise(() => store.forget!(ctx.payload.id))
          if (!removed)
            return yield* new InvalidRequestError({ message: "Memory record not found", field: "id" })
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("grist.codeMap.get", () =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          const provider = createGraphifyProvider({ cwd: location.project.directory })
          const status = yield* Effect.promise(() => provider.status())
          if (!status.available || !status.graphPath)
            return { available: false, detail: status.detail, nodes: 0, edges: 0, top: [] }
          const summary = yield* Effect.tryPromise(() =>
            readFile(status.graphPath!, "utf8").then((raw) =>
              summarizeGraph(loadGraphifyDocument(JSON.parse(raw) as Parameters<typeof loadGraphifyDocument>[0])),
            ),
          ).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!summary) return { available: false, detail: "Code map graph could not be read", nodes: 0, edges: 0, top: [] }
          return { available: true, detail: status.detail, ...summary }
        }),
      )
  }),
)

function environmentError(error: EnvironmentRegistry.Error): InvalidRequestError {
  if (error instanceof Project.NotFoundError)
    return new InvalidRequestError({ message: `Project not found: ${error.projectID}` })
  if (error instanceof EnvironmentRegistry.NotFoundError)
    return new InvalidRequestError({ message: `Environment not found: ${error.name}`, field: "name" })
  if (error instanceof EnvironmentRegistry.NameTakenError)
    return new InvalidRequestError({ message: `Environment name already in use: ${error.name}`, field: "name" })
  if (error instanceof EnvironmentRegistry.LocalImmutableError)
    return new InvalidRequestError({
      message:
        error.operation === "create"
          ? "The local environment always exists and cannot be created"
          : "The local environment cannot be removed",
    })
  if (error instanceof EnvironmentRegistry.SandboxUnavailableError)
    return new InvalidRequestError({ message: "Sandbox environments are not available yet" })
  return new InvalidRequestError({
    message:
      "message" in error && typeof error.message === "string" ? error.message : `Environment operation failed: ${error._tag}`,
  })
}
