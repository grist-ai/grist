import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { decideInboxItem, loadInviteConfig } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { formatInboxItem } from "./shared"

/**
 * `grist inbox decide <item-id> approve|deny [--answer "…"]`.
 * Decisions are human-only at the gateway: the account holder's own
 * sign-in decides; a delegated API key is refused there with
 * `deciding_requires_account_auth`, surfaced here as-is.
 */
export default Runtime.handler(Commands.commands.inbox.commands.decide, (input) =>
  Effect.promise(async () => {
    const fail = (message: string) => {
      process.stdout.write(
        (input.format === "json" ? JSON.stringify({ error: message }, null, 2) : message) + EOL,
      )
    }
    if (input.decision !== "approve" && input.decision !== "deny") {
      fail(`Decision must be "approve" or "deny", not "${input.decision}".`)
      return
    }
    const config = loadInviteConfig()
    if (!config) {
      fail("Not signed in to Grist — run: grist auth login --provider grist")
      return
    }
    try {
      const answer = Option.getOrUndefined(input.answer)
      const result = await decideInboxItem(config, {
        itemId: input.item,
        decision: input.decision,
        ...(answer ? { answer } : {}),
      })
      if (input.format === "json") {
        process.stdout.write(JSON.stringify(result, null, 2) + EOL)
        return
      }
      const released =
        result.request && result.item.source === "envelope_breach"
          ? result.request.state === "queued"
            ? " The parked request is claimable again."
            : ` The parked request is now ${result.request.state}.`
          : result.item.source !== "envelope_breach" && result.item.state === "approved"
            ? " The answer resumes the run's session on the runner's next cycle."
            : ""
      process.stdout.write(formatInboxItem(result.item) + released + EOL)
    } catch (error) {
      fail(error instanceof Error ? error.message : "The decision could not be recorded.")
    }
  }),
)
