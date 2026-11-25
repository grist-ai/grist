import { describe, expect, test } from "bun:test"
import { Message } from "@opencode/ai"
import type { Tool } from "@opencode/schema/tool"

import { distillFailures, distillSuccesses } from "@grist-ai/logic"

import { toolPartFromError, toolPartFromResult, type ToolPartLike } from "../src/capture.js"
import { compressHistory } from "../src/context-compression.js"

/**
 * Capture-integrity regression: verified-outcomes memory distills from the
 * per-session tool history that `tool.execute.after` builds out of RAW tool
 * results (capture.ts). Context compression transforms only the per-request
 * provider copy. This test runs the real capture construction and the real
 * distillers in two worlds — compression off, and compression on with the
 * provider copy verifiably shrunk — and requires the capture inputs and the
 * distilled candidates to be byte-identical across both.
 */

const bigJsonText = JSON.stringify(
  { rows: Array.from({ length: 40 }, (_, i) => ({ id: i, name: `row-${i}`, value: i * 3 })) },
  null,
  2,
)

const testOutput = ["(pass) adds numbers [1.00ms]", "(pass) subtracts numbers [0.50ms]", "", " 42 pass", " 0 fail"].join("\n")

type Execution =
  | { kind: "completed"; tool: string; args: Record<string, unknown>; result: Tool.Result }
  | { kind: "error"; tool: string; args: Record<string, unknown>; error: string }

const executions: Array<Execution> = [
  { kind: "error", tool: "bash", args: { command: "bun test" }, error: "exit code: 1 — 3 fail" },
  { kind: "error", tool: "bash", args: { command: "bun test" }, error: "exit code: 1 — 3 fail" },
  { kind: "completed", tool: "edit", args: { path: "src/math.ts" }, result: { content: "edit applied" } },
  { kind: "completed", tool: "read", args: { path: "data.json" }, result: { content: bigJsonText } },
  { kind: "completed", tool: "bash", args: { command: "bun test" }, result: { content: testOutput } },
]

/** Exactly what tool.execute.after accumulates, per execution. */
function captureParts(): Array<ToolPartLike> {
  return executions.map((execution) =>
    execution.kind === "completed"
      ? toolPartFromResult(execution.tool, execution.args, execution.result)
      : toolPartFromError(execution.tool, execution.args, execution.error),
  )
}

function toolCall(id: string, name: string): Message {
  return Message.make({ role: "assistant", content: [{ type: "tool-call", id, name, input: {} }] })
}

function toolOutput(id: string, name: string, value: string): Message {
  return Message.make({
    role: "tool",
    content: [{ type: "tool-result", id, name, result: { type: "text", value } }],
  })
}

/** The provider-bound history built from the same raw results. */
function providerMessages(): Array<Message> {
  const messages: Array<Message> = [
    Message.user("fix math.ts, inspect data.json, and run the tests"),
    toolCall("c1", "edit"),
    toolOutput("c1", "edit", "edit applied"),
    toolCall("c2", "read"),
    toolOutput("c2", "read", bigJsonText),
    toolCall("c3", "bash"),
    toolOutput("c3", "bash", testOutput),
  ]
  for (let i = 0; i < 4; i++) messages.push(toolCall(`f${i}`, "bash"), toolOutput(`f${i}`, "bash", "ok"))
  messages.push(Message.user("next"))
  return messages
}

describe("capture integrity under context compression", () => {
  test("capture inputs and distilled candidates are byte-identical with compression on or off", () => {
    // World OFF: capture accumulates from raw results; no transform runs.
    const partsOff = captureParts()

    // World ON: the provider copy is compressed (and really shrinks)…
    const messages = providerMessages()
    const report = compressHistory(messages, { budgetBytes: 1_000 })
    expect(report.compressed).toBe(true)
    expect(report.bytesSaved).toBeGreaterThan(0)
    const compressedRead = report.messages[4]?.content[0]
    if (compressedRead?.type !== "tool-result" || compressedRead.result.type !== "text") {
      throw new Error("expected the read output to stay a text tool result")
    }
    expect(compressedRead.result.value).not.toBe(bigJsonText)
    expect(compressedRead.result.value as string).toContain("similar items omitted")
    // …the stored/original messages are not mutated by the transform…
    const originalRead = messages[4]?.content[0]
    if (originalRead?.type !== "tool-result" || originalRead.result.type !== "text") {
      throw new Error("expected the original read output to stay a text tool result")
    }
    expect(originalRead.result.value).toBe(bigJsonText)

    // …and capture, built afterwards from the same raw results, is unchanged.
    const partsOn = captureParts()
    expect(JSON.stringify(partsOn)).toBe(JSON.stringify(partsOff))
    expect(partsOn.map((part) => part.state?.output)).toEqual(partsOff.map((part) => part.state?.output))

    const successesOff = distillSuccesses({ parts: partsOff, container: "repo", sessionID: "ses_integrity" })
    const successesOn = distillSuccesses({ parts: partsOn, container: "repo", sessionID: "ses_integrity" })
    expect(successesOff.length).toBe(1)
    expect(JSON.stringify(successesOn)).toBe(JSON.stringify(successesOff))
    expect(successesOn[0]?.content).toContain("42 pass, 0 fail")

    const failuresOff = distillFailures({ parts: partsOff, container: "repo", recovered: false, sessionID: "ses_integrity" })
    const failuresOn = distillFailures({ parts: partsOn, container: "repo", recovered: false, sessionID: "ses_integrity" })
    expect(JSON.stringify(failuresOn)).toBe(JSON.stringify(failuresOff))
  })
})
