import type { InboxItemWire } from "@grist-ai/logic"

/** Pure rendering of `grist inbox list` rows. Never includes any
 * credential; firebase uids never reach the wire shape at all. */
export function formatInboxItem(item: InboxItemWire): string {
  const lines = [
    `${item.id}  ${item.state}  ${item.source} · ${item.boundary}  ${new Date(item.created_at).toISOString()}`,
    `  ${item.question}`,
  ]
  const context: string[] = []
  if (item.request_id) context.push(`request ${item.request_id}`)
  if (item.session_id) context.push(`session ${item.session_id}`)
  const listenerName = item.detail.listener_name
  if (typeof listenerName === "string") context.push(`listener ${listenerName}`)
  const reason = item.detail.reason
  if (typeof reason === "string") context.push(reason.replaceAll("_", " "))
  if (context.length > 0) lines.push(`  ${context.join(" · ")}`)
  if (item.state === "pending") {
    lines.push(`  undecided by ${new Date(item.expires_at).toISOString()} it expires unanswered (fails closed)`)
  }
  if (item.answer) lines.push(`  answer: ${item.answer}`)
  return lines.join("\n")
}
