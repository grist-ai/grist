import { EOL } from "node:os"
import { Effect } from "effect"
import { setTeamMemoryEnabled } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(Commands.commands["team-memory"].commands.enable, () =>
  Effect.promise(async () => {
    const cwd = process.cwd()
    await setTeamMemoryEnabled(cwd, true)
    process.stdout.write(
      `Team memory sync enabled for ${cwd}` +
        EOL +
        "Verified learnings captured here will sync to your team; team entries will be recalled at task start." +
        EOL,
    )
  }),
)
