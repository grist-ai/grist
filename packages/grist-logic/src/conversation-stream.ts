/**
 * S-CONV1 — the conversation posted stream: a projection over the thread
 * model, never a second transcript (spec §5.1).
 *
 * A conversation's stream is the deliberate subset of its linked sessions'
 * thread items: user messages, assistant results, outcomes, questions
 * (Jev gate approval requests), file references from steps, and lifecycle
 * notes. Raw tool calls, reasoning, shell detail, compaction, and usage
 * stay in the session inspect view, which is unchanged — nothing is
 * hidden, it is layered.
 *
 * Classification is NOT reimplemented here: per-message thread items come
 * from `itemsFromStoredMessages` in thread-model.ts, the same projection
 * the thread view renders. This module only selects and re-tags them with
 * the owning session. User messages are the one addition: the stored-row
 * projection folds them into a bare lifecycle item, so their text is read
 * directly from the stored user message — the classification of everything
 * else is the thread model's.
 */

import { itemsFromStoredMessages, type StoredMessage, type ThreadItem } from "./thread-model.js"

export type PostedItem =
  | { kind: "user"; sessionID: string; text: string }
  | { kind: "message"; sessionID: string; text: string }
  | { kind: "outcome"; sessionID: string; status: "succeeded" | "failed" | "interrupted" }
  | { kind: "question"; sessionID: string; reason?: string; rung?: string }
  | { kind: "files"; sessionID: string; files: string[] }
  | { kind: "lifecycle"; sessionID: string; event: string }

export type PostedSessionInput = {
  sessionID: string
  messages: StoredMessage[]
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** One thread item → its posted form, or undefined when the item is inspect-only detail. */
export function postedItemFromThreadItem(sessionID: string, item: ThreadItem): PostedItem | undefined {
  switch (item.kind) {
    case "message":
      return str(item.text) ? { kind: "message", sessionID, text: item.text } : undefined
    case "outcome":
      return { kind: "outcome", sessionID, status: item.status }
    case "approval_request":
      return { kind: "question", sessionID, reason: item.reason, rung: item.rung }
    case "step":
      // A step's file list is the conversation-level fact (what the work
      // touched); its cost is inspect detail and stays in the session view.
      return item.files && item.files.length > 0 ? { kind: "files", sessionID, files: item.files } : undefined
    case "lifecycle":
      return { kind: "lifecycle", sessionID, event: item.event }
    case "reasoning":
    case "tool":
    case "shell":
    case "compaction":
    case "usage":
      return undefined
  }
}

/**
 * One conversation's posted stream: its sessions' posted items in link
 * order, each session's items in stored order — one continuous stream.
 */
export function postedStream(sessions: readonly PostedSessionInput[]): PostedItem[] {
  const posted: PostedItem[] = []
  for (const session of sessions) {
    for (const message of session.messages) {
      if (message.type === "user") {
        const text = str(message.data?.text)
        if (text) posted.push({ kind: "user", sessionID: session.sessionID, text })
        continue
      }
      for (const item of itemsFromStoredMessages([message])) {
        const entry = postedItemFromThreadItem(session.sessionID, item)
        if (entry) posted.push(entry)
      }
    }
  }
  return posted
}

/**
 * "What was learned here": the memory join (spec §5.1). Captured entries
 * carry their session id; a conversation's entries are exactly those whose
 * session is one of its linked sessions. Record order is preserved (the
 * store lists newest first). No capture change — this is a read-side join.
 */
export function memoryForConversation<T extends { sessionID?: string }>(
  records: readonly T[],
  sessionIDs: readonly string[],
): T[] {
  const linked = new Set(sessionIDs)
  return records.filter((record) => record.sessionID !== undefined && linked.has(record.sessionID))
}
