import type { ConversationInfo } from "@opencode/client"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { conversationClient, currentLocation, reportError } from "./shared"

const handler = Effect.fn("cli.conversation.list")(function* (
  input: Runtime.Input<typeof Commands.commands.conversation.commands.list>,
) {
  const client = yield* conversationClient(input)
  const result = yield* Effect.tryPromise({
    try: (signal) => client.grist.conversation.list(currentLocation, { signal }),
    catch: (cause) => cause,
  })
  const output =
    (input.format === "json" ? JSON.stringify(result.conversations, null, 2) : formatList(result.conversations)) + EOL
  process.stdout.write(output)
})

export default Runtime.handler(Commands.commands.conversation.commands.list, (input) =>
  handler(input).pipe(Effect.catch(reportError)),
)

function formatList(conversations: ReadonlyArray<ConversationInfo>) {
  if (conversations.length === 0) return "No conversations"
  return conversations
    .map((conversation) =>
      [
        conversation.id,
        conversation.status,
        `${conversation.sessionIDs.length} session${conversation.sessionIDs.length === 1 ? "" : "s"}`,
        conversation.title.replace(/[\r\n\t]/g, " "),
      ].join("\t"),
    )
    .join(EOL)
}
