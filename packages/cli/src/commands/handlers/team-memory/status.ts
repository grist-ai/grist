import { EOL } from "node:os"
import { Effect } from "effect"
import { readTeamSyncStateSync, summarizeTeamSyncState } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { formatTeamMemoryStatus, teamMemoryStatusJson } from "./shared"

export default Runtime.handler(Commands.commands["team-memory"].commands.status, (input) =>
  Effect.sync(() => {
    const cwd = process.cwd()
    const status = summarizeTeamSyncState(readTeamSyncStateSync(cwd), cwd)
    process.stdout.write(
      (input.format === "json"
        ? JSON.stringify(teamMemoryStatusJson(status, cwd), null, 2)
        : formatTeamMemoryStatus(status, cwd)) + EOL,
    )
  }),
)
