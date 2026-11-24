import { EOL } from "node:os"
import { Effect } from "effect"
import { readTeamSyncStateSync, summarizeTeamObjects } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { formatTeamObjectsStatus, teamObjectsStatusJson } from "./shared"

export default Runtime.handler(Commands.commands["team-objects"].commands.status, (input) =>
  Effect.sync(() => {
    const cwd = process.cwd()
    const status = summarizeTeamObjects(readTeamSyncStateSync(cwd), cwd)
    process.stdout.write(
      (input.format === "json"
        ? JSON.stringify(teamObjectsStatusJson(status, cwd), null, 2)
        : formatTeamObjectsStatus(status, cwd)) + EOL,
    )
  }),
)
