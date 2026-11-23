import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { formatGristStatus, gristStatus, gristStatusJson } from "./grist-status"

export default Runtime.handler(Commands.commands.auth.commands.status, (input) =>
  Effect.gen(function* () {
    const status = yield* gristStatus({})
    process.stdout.write(
      (input.format === "json" ? JSON.stringify(gristStatusJson(status), null, 2) : formatGristStatus(status)) +
        EOL,
    )
  }),
)
