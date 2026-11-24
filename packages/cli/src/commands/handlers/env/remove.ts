import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { currentLocation, envClient, reportError } from "./shared"

const handler = Effect.fn("cli.env.remove")(function* (
  input: Runtime.Input<typeof Commands.commands.env.commands.remove>,
) {
  const client = yield* envClient(input)
  yield* Effect.tryPromise({
    try: (signal) =>
      client.grist.environment.remove({ ...currentLocation, name: input.name, force: input.force }, { signal }),
    catch: (cause) => cause,
  })
  process.stdout.write(`Removed environment ${input.name}` + EOL)
})

export default Runtime.handler(Commands.commands.env.commands.remove, (input) =>
  handler(input).pipe(Effect.catch(reportError)),
)
