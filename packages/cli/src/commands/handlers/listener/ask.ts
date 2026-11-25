import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { INBOX_BOUNDARIES, loadInviteConfig, postInboxItem, type InboxBoundary } from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

/**
 * `grist listener ask <boundary> "<question>"` (spec §7 source 3):
 * the deliberate-question mechanism for unattended runs. The runner
 * exposes the claimed request as GRIST_LISTENER_REQUEST_ID (and the
 * session, when resuming, via --session) so the item links back to
 * the run; a human's answer resumes the session on a later cycle.
 */
export default Runtime.handler(Commands.commands.listener.commands.ask, (input) =>
  Effect.promise(async () => {
    const fail = (message: string) => {
      process.stdout.write(
        (input.format === "json" ? JSON.stringify({ error: message }, null, 2) : message) + EOL,
      )
    }
    if (!(INBOX_BOUNDARIES as readonly string[]).includes(input.boundary)) {
      fail(
        `Unknown boundary "${input.boundary}". The cross-boundary list is fixed: ${INBOX_BOUNDARIES.join(", ")}.`,
      )
      return
    }
    const config = loadInviteConfig()
    if (!config) {
      fail("Not signed in to Grist — run: grist auth login --provider grist")
      return
    }
    const requestId = process.env.GRIST_LISTENER_REQUEST_ID
    const sessionId = Option.getOrUndefined(input.session) ?? process.env.GRIST_LISTENER_SESSION_ID
    try {
      const item = await postInboxItem(config, {
        source: "question",
        boundary: input.boundary as InboxBoundary,
        question: input.question,
        ...(requestId ? { requestId } : {}),
        ...(sessionId ? { sessionId } : {}),
      })
      process.stdout.write(
        (input.format === "json"
          ? JSON.stringify(item, null, 2)
          : `Posted to the approvals inbox as ${item.id} — a human decides; the answer resumes the session. Undecided items expire unanswered (the timeout fails closed).`) + EOL,
      )
    } catch (error) {
      fail(error instanceof Error ? error.message : "The question could not be posted.")
    }
  }),
)
