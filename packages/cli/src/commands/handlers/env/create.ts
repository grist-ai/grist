import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { currentLocation, envClient, reportError } from "./shared"

const handler = Effect.fn("cli.env.create")(function* (
  input: Runtime.Input<typeof Commands.commands.env.commands.create>,
) {
  const client = yield* envClient(input)
  const created = yield* Effect.tryPromise({
    try: (signal) =>
      client.grist.environment.create({ ...currentLocation, name: input.name, kind: input.kind }, { signal }),
    catch: (cause) => cause,
  })
  process.stdout.write(
    `Created environment ${created.name} (${created.kind})` +
      (created.directory ? ` at ${created.directory}` : "") +
      (created.branch ? ` on branch ${created.branch}` : "") +
      EOL,
  )
})

export default Runtime.handler(Commands.commands.env.commands.create, (input) =>
  handler(input).pipe(Effect.catch(reportError)),
)
