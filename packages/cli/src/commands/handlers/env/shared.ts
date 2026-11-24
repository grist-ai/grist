import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

/**
 * Shared plumbing for the `grist env` commands: resolve the server the
 * same way the session commands do. Registry failures come back from the
 * server as InvalidRequestError carrying a readable message, which the
 * handlers surface verbatim via `reportError`.
 */
export function envClient(input: { server: Option.Option<string>; standalone: boolean }) {
  return Effect.gen(function* () {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    return OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  })
}

export function reportError(error: unknown) {
  return Effect.sync(() => {
    process.stderr.write(errorMessage(error) + EOL)
    process.exitCode = 1
  })
}

export const currentLocation = { location: { directory: process.cwd() } }
