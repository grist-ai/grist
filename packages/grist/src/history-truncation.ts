/**
 * Gateway body-limit guard: shrink oldest tool output so the serialized history
 * stays under the completions endpoint's body cap.
 *
 * `packages/grist-gateway/src/http.ts` reads completions bodies with a 256 KB
 * limit; a session whose serialized history crosses it gets a 413 and cannot
 * resume. This module trims only old tool-output text, oldest first, and leaves
 * the system prompt, the latest user message, and the most recent turn intact so
 * current task state survives.
 */
import { Message, type ToolResultPart } from "@opencode/ai"

/** The gateway completions endpoint rejects request bodies over 256 KB. */
export const GATEWAY_BODY_LIMIT_BYTES = 256 * 1024

/**
 * Leave headroom under the gateway cap for the system prompt, generation options,
 * and JSON envelope overhead.
 */
export const DEFAULT_TRUNCATION_THRESHOLD = 200_000

/** Tool outputs smaller than this are not worth replacing with a tombstone. */
const MIN_TRUNCATABLE_PART_BYTES = 1_024

export type TruncationReport = {
  /** The (possibly rebuilt) message list to send; identical when nothing changed. */
  messages: Array<Message>
  truncated: boolean
  bytesDropped: number
  partsShrunk: number
  finalSize: number
}

function estimateBodyBytes(messages: ReadonlyArray<Message>): number {
  return JSON.stringify(messages).length
}

/**
 * Shrink oldest tool-output text parts until the serialized history fits under
 * `threshold`, returning the message list to send. Only tool-result text is
 * replaced with a tombstone; messages are never dropped and tool-call/tool-result
 * pairing is preserved (ids stay).
 *
 * The system role, the latest user message, and everything after it (the most
 * recent turn) are never touched.
 */
export function truncateHistory(
  messages: Array<Message>,
  threshold = DEFAULT_TRUNCATION_THRESHOLD,
): TruncationReport {
  const initial = estimateBodyBytes(messages)
  if (initial <= threshold) {
    return { messages, truncated: false, bytesDropped: 0, partsShrunk: 0, finalSize: initial }
  }

  const protectedFrom = protectedTailStart(messages)
  const next = [...messages]
  let size = initial
  let bytesDropped = 0
  let partsShrunk = 0

  for (let index = 0; index < protectedFrom && size > threshold; index++) {
    const message = next[index]
    if (message.role === "system") continue
    const content = [...message.content]
    let changed = false
    for (let position = 0; position < message.content.length && size > threshold; position++) {
      const part = message.content[position]
      if (part.type !== "tool-result") continue
      const shrunk = shrinkToolResult(part)
      if (!shrunk) continue
      content[position] = shrunk.part
      changed = true
      size -= shrunk.dropped
      bytesDropped += shrunk.dropped
      partsShrunk++
    }
    if (changed) next[index] = Message.make({ ...message, content })
  }

  const truncated = partsShrunk > 0
  return {
    messages: truncated ? next : messages,
    truncated,
    bytesDropped,
    partsShrunk,
    finalSize: size,
  }
}

/** Index of the latest user message; everything from here onward is protected. */
function protectedTailStart(messages: ReadonlyArray<Message>): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") return index
  }
  return messages.length - 1
}

type ShrinkResult = { part: ToolResultPart; dropped: number }

/** Replace a large tool-result text payload with a tombstone. */
function shrinkToolResult(part: ToolResultPart): ShrinkResult | undefined {
  const text = toolResultText(part)
  if (text === undefined || text.length < MIN_TRUNCATABLE_PART_BYTES) return undefined

  const tombstone = `[grist] truncated ${text.length} bytes of tool output to stay under the gateway body limit`
  if (tombstone.length >= text.length) return undefined

  const shrunk: ToolResultPart =
    part.result.type === "content"
      ? { ...part, result: { type: "content", value: [{ type: "text", text: tombstone }] } }
      : { ...part, result: { type: "text", value: tombstone } }
  return { part: shrunk, dropped: text.length - tombstone.length }
}

function toolResultText(part: ToolResultPart): string | undefined {
  if (part.result.type === "text") {
    return typeof part.result.value === "string" ? part.result.value : undefined
  }
  if (part.result.type === "content") {
    const texts = part.result.value.flatMap((content) => (content.type === "text" ? [content.text] : []))
    return texts.length > 0 ? texts.join("\n") : undefined
  }
  return undefined
}
