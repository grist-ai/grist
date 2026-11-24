import { EOL } from "node:os"
import { Effect } from "effect"
import { runListenerCycle } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { execListenerRun, formatCycleResult } from "./shared"

export default Runtime.handler(Commands.commands.listener.commands["run-once"], (input) =>
  Effect.promise(async () => {
    const result = await runListenerCycle(process.cwd(), { execRun: execListenerRun })
    process.stdout.write(
      (input.format === "json" ? JSON.stringify(result, null, 2) : formatCycleResult(result)) + EOL,
    )
  }),
)
