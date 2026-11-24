import { EOL } from "node:os"
import { Effect } from "effect"
import {
  readListenerRunnerStateSync,
  runnerMachineName,
  summarizeListenerRunnerState,
} from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { formatListenerStatus, listenerStatusJson } from "./shared"

export default Runtime.handler(Commands.commands.listener.commands.status, (input) =>
  Effect.sync(() => {
    const cwd = process.cwd()
    const status = summarizeListenerRunnerState(
      readListenerRunnerStateSync(cwd),
      cwd,
      runnerMachineName(),
    )
    process.stdout.write(
      (input.format === "json"
        ? JSON.stringify(listenerStatusJson(status, cwd), null, 2)
        : formatListenerStatus(status, cwd)) + EOL,
    )
  }),
)
