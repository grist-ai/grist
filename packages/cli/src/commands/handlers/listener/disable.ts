import { EOL } from "node:os"
import { Effect } from "effect"
import { setListenerRunnerEnabled } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(Commands.commands.listener.commands.disable, () =>
  Effect.sync(() => {
    const cwd = process.cwd()
    setListenerRunnerEnabled(cwd, false)
    process.stdout.write(
      `Listener runner disabled for ${cwd} on this machine` +
        EOL +
        "Queued requests for this repo will no longer be claimed here; other machines are unaffected." +
        EOL,
    )
  }),
)
