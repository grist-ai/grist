import type { EnvironmentInfo } from "@opencode/client"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { currentLocation, envClient, reportError } from "./shared"

const handler = Effect.fn("cli.env.list")(function* (
  input: Runtime.Input<typeof Commands.commands.env.commands.list>,
) {
  const client = yield* envClient(input)
  const result = yield* Effect.tryPromise({
    try: (signal) => client.grist.environment.list(currentLocation, { signal }),
    catch: (cause) => cause,
  })
  const output =
    (input.format === "json" ? JSON.stringify(result.environments, null, 2) : formatList(result.environments)) + EOL
  process.stdout.write(output)
})

export default Runtime.handler(Commands.commands.env.commands.list, (input) =>
  handler(input).pipe(Effect.catch(reportError)),
)

function formatList(environments: ReadonlyArray<EnvironmentInfo>) {
  if (environments.length === 0) return "No environments"
  return environments
    .map((environment) =>
      [
        environment.name,
        environment.kind,
        environment.status,
        environment.directory ?? "",
        environment.branch ?? "",
      ].join("\t"),
    )
    .join(EOL)
}
