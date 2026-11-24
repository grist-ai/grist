import type { GristConversationView } from "@opencode/client"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { conversationClient, currentLocation, reportError } from "./shared"

const handler = Effect.fn("cli.conversation.show")(function* (
  input: Runtime.Input<typeof Commands.commands.conversation.commands.show>,
) {
  const client = yield* conversationClient(input)
  const view = yield* Effect.tryPromise({
    try: (signal) => client.grist.conversation.show({ ...currentLocation, id: input.id }, { signal }),
    catch: (cause) => cause,
  })
  const output = (input.format === "json" ? JSON.stringify(view, null, 2) : formatView(view)) + EOL
  process.stdout.write(output)
})

export default Runtime.handler(Commands.commands.conversation.commands.show, (input) =>
  handler(input).pipe(Effect.catch(reportError)),
)

function formatView(view: GristConversationView) {
  const lines = [
    `${view.conversation.id}\t${view.conversation.status}\t${view.conversation.title.replace(/[\r\n\t]/g, " ")}`,
    "",
    "Sessions:",
    ...(view.conversation.sessionIDs.length === 0
      ? ["  (none)"]
      : view.conversation.sessionIDs.map((sessionID) => `  ${sessionID}`)),
    "",
    "Posted stream:",
    ...(view.stream.length === 0 ? ["  (empty)"] : view.stream.map((item) => `  ${formatItem(item)}`)),
    "",
    "Memory:",
    ...(view.memory.length === 0
      ? ["  (none)"]
      : view.memory.map((record) => `  [${record.outcome}] ${record.content.replace(/[\r\n]+/g, " ")}`)),
  ]
  return lines.join(EOL)
}

function formatItem(item: GristConversationView["stream"][number]): string {
  switch (item.kind) {
    case "user":
      return `user: ${item.text ?? ""}`
    case "message":
      return `assistant: ${item.text ?? ""}`
    case "outcome":
      return `outcome: ${item.status ?? ""}`
    case "question":
      return `question: ${item.reason ?? "approval requested"}`
    case "files":
      return `files: ${(item.files ?? []).join(", ")}`
    case "lifecycle":
      return `lifecycle: ${item.event ?? ""}`
  }
}
