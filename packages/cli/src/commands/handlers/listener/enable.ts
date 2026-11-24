import { EOL } from "node:os"
import { Effect } from "effect"
import { setListenerRunnerEnabled } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(Commands.commands.listener.commands.enable, () =>
  Effect.sync(() => {
    const cwd = process.cwd()
    setListenerRunnerEnabled(cwd, true)
    process.stdout.write(
      `Listener runner enabled for ${cwd} on this machine` +
        EOL +
        "This machine will claim queued listener requests for this repo and run them as each listener's creator." +
        EOL,
    )
  }),
)
