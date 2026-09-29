import { describe, expect, test } from "bun:test"
import { Message } from "@opencode/ai"

import { DEFAULT_TRUNCATION_THRESHOLD, truncateHistory } from "../src/history-truncation.js"

const bigText = (length: number) => "x".repeat(length)

function toolCall(id: string, name: string): Message {
  return Message.make({
    role: "assistant",
    content: [{ type: "tool-call", id, name, input: {} }],
  })
}

function toolOutput(id: string, name: string, value: string): Message {
  return Message.make({
    role: "tool",
    content: [{ type: "tool-result", id, name, result: { type: "text", value } }],
  })
}

function outputText(message: Message): string {
  const part = message.content[0]
  if (part?.type !== "tool-result" || part.result.type !== "text") throw new Error("not a text tool result")
  return part.result.value as string
}

function oversizedHistory() {
  const oldOutput = bigText(300_000)
  const tailOutput = bigText(5_000)
  return {
    oldOutput,
    tailOutput,
    messages: [
      Message.system("doctrine"),
      toolCall("c1", "read"),
      toolOutput("c1", "read", oldOutput),
      Message.user("latest task"),
      toolCall("c2", "edit"),
      toolOutput("c2", "edit", tailOutput),
    ],
  }
}

describe("truncateHistory", () => {
  test("leaves an under-threshold history untouched", () => {
    const messages = [Message.user("hello"), toolCall("c1", "read"), toolOutput("c1", "read", bigText(5_000))]

    const report = truncateHistory(messages)

    expect(report.truncated).toBe(false)
    expect(report.messages).toBe(messages)
    expect(outputText(messages[2])).toBe(bigText(5_000))
  })

  test("shrinks old tool output with a tombstone and preserves the recent tail", () => {
    const { messages, tailOutput } = oversizedHistory()

    const report = truncateHistory(messages)

    expect(report.truncated).toBe(true)
    expect(report.partsShrunk).toBe(1)
    expect(outputText(report.messages[2])).toContain("[grist] truncated")
    expect(outputText(report.messages[2])).toContain("gateway body limit")
    expect(outputText(report.messages[5])).toBe(tailOutput)
    expect(report.finalSize).toBeLessThanOrEqual(DEFAULT_TRUNCATION_THRESHOLD)
    expect(JSON.stringify(report.messages).length).toBeLessThanOrEqual(DEFAULT_TRUNCATION_THRESHOLD)
  })

  test("preserves message count and tool-call/tool-result pairing", () => {
    const { messages, oldOutput } = oversizedHistory()

    const report = truncateHistory(messages)

    expect(report.messages).toHaveLength(messages.length)
    const call = report.messages[1].content[0]
    const result = report.messages[2].content[0]
    if (call.type !== "tool-call" || result.type !== "tool-result") throw new Error("unexpected part type")
    expect(result.id).toBe(call.id)
    expect(result.name).toBe(call.name)
    expect(outputText(report.messages[2])).not.toBe(oldOutput)
  })

  test("truncates oldest first and stops once under the limit", () => {
    const untouched = bigText(5_000)
    const messages = [toolOutput("c1", "read", bigText(260_000)), toolOutput("c2", "read", untouched), Message.user("latest")]

    const report = truncateHistory(messages)

    expect(report.partsShrunk).toBe(1)
    expect(outputText(report.messages[0])).toContain("[grist] truncated")
    expect(outputText(report.messages[1])).toBe(untouched)
  })

  test("treats exactly-at-threshold as untouched and one byte over as over", () => {
    const atLimit = [toolOutput("c1", "read", bigText(50_000)), Message.user("latest")]
    const size = JSON.stringify(atLimit).length

    expect(truncateHistory(atLimit, size).truncated).toBe(false)

    const overLimit = [toolOutput("c1", "read", bigText(50_000)), Message.user("latest")]
    const report = truncateHistory(overLimit, size - 1)

    expect(report.truncated).toBe(true)
    expect(outputText(report.messages[0])).toContain("[grist] truncated")
  })

  test("keeps the most recent turn intact even when it alone exceeds the limit", () => {
    const huge = bigText(300_000)
    const messages = [Message.user("latest"), toolCall("c1", "read"), toolOutput("c1", "read", huge)]

    const report = truncateHistory(messages)

    expect(report.truncated).toBe(false)
    expect(report.messages).toBe(messages)
    expect(outputText(messages[2])).toBe(huge)
  })
})
