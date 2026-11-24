import { EOL } from "node:os"
import { Effect } from "effect"
import { runListenerWatch } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { execListenerRun, formatCycleResult } from "./shared"

export default Runtime.handler(Commands.commands.listener.commands.watch, () =>
  Effect.promise(async () => {
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)
    try {
      process.stdout.write("Listener runner watching — Ctrl-C to stop." + EOL)
      await runListenerWatch(process.cwd(), {
        execRun: execListenerRun,
        signal: controller.signal,
        onCycle: (result) => {
          // Idle polls stay quiet; anything that changed state is shown.
          if (result.status === "idle") return
          process.stdout.write(formatCycleResult(result) + EOL)
        },
      })
    } finally {
      process.off("SIGINT", stop)
      process.off("SIGTERM", stop)
    }
  }),
)
