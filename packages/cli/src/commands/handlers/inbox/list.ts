import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { listInboxItems, loadInviteConfig } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { formatInboxItem } from "./shared"

export default Runtime.handler(Commands.commands.inbox.commands.list, (input) =>
  Effect.promise(async () => {
    const config = loadInviteConfig()
    if (!config) {
      process.stdout.write("Not signed in to Grist — run: grist auth login --provider grist" + EOL)
      return
    }
    try {
      const state = Option.getOrUndefined(input.state)
      const items = await listInboxItems(config, {
        ...(state ? { state } : {}),
        limit: 100,
      })
      if (input.format === "json") {
        process.stdout.write(JSON.stringify({ items }, null, 2) + EOL)
        return
      }
      if (items.length === 0) {
        process.stdout.write("The inbox is empty." + EOL)
        return
      }
      process.stdout.write(items.map(formatInboxItem).join("\n") + EOL)
    } catch (error) {
      process.stdout.write(
        (error instanceof Error ? error.message : "The inbox could not be read.") + EOL,
      )
    }
  }),
)
