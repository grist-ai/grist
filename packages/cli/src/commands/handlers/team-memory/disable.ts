import { EOL } from "node:os"
import { Effect } from "effect"
import { setTeamMemoryEnabled } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(Commands.commands["team-memory"].commands.disable, () =>
  Effect.promise(async () => {
    const cwd = process.cwd()
    await setTeamMemoryEnabled(cwd, false)
    process.stdout.write(
      `Team memory sync disabled for ${cwd}` + EOL + "Local memory is unaffected; queued entries stay queued locally." + EOL,
    )
  }),
)
