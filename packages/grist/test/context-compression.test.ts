import { describe, expect, test } from "bun:test"
import { Message } from "@opencode/ai"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  DEFAULT_COMPRESSION_BUDGET_BYTES,
  MAX_COMPRESSION_BUDGET_BYTES,
  MIN_COMPRESSION_BUDGET_BYTES,
  appendCompressionSessionRecord,
  compressHistory,
  compressJsonValue,
  compressToolOutputText,
  compressionStatsPath,
  contextCompressionConfigPath,
  readCompressionSessionRecords,
  recordCompressionReport,
  resolveContextCompression,
} from "../src/context-compression.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** A shell log with collapsible repeats, progress noise, and one error line. */
function noisyLog(lines = 120): string {
  const out: Array<string> = ["starting build"]
  for (let i = 0; i < lines; i++) out.push("compiling module chunk")
  out.push("42% |████░░░░░░")
  out.push("error: something specific broke in module 7")
  for (let i = 0; i < lines; i++) out.push("linking object file")
  out.push("done in 4s")
  return out.join("\n")
}

/** Four tiny outputs — filler that occupies the protected recent-four slots. */
function fillers(start: number): Array<Message> {
  const out: Array<Message> = []
  for (let i = 0; i < 4; i++) {
    out.push(toolCall(`f${start + i}`, "bash"), toolOutput(`f${start + i}`, "bash", "ok"))
  }
  return out
}

function jsonRows(count: number): string {
  const rows = Array.from({ length: count }, (_, i) => ({ id: i, name: `row-${i}`, value: i * 3 }))
  return JSON.stringify({ rows }, null, 2)
}

// ---------------------------------------------------------------------------
// Compressors
// ---------------------------------------------------------------------------

describe("compressToolOutputText — json", () => {
  test("collapses a long array of similar rows and minifies", () => {
    const text = jsonRows(40)
    const result = compressToolOutputText(text)
    expect(result).toBeDefined()
    expect(result?.kinds).toEqual(["json"])
    expect(result?.text).toContain("similar items omitted")
    expect(result?.text).not.toContain("\n")
    const parsed = JSON.parse(result?.text as string) as { rows: Array<unknown> }
    expect(parsed.rows.length).toBeLessThan(40)
    expect(JSON.stringify(parsed.rows[0])).toContain('"id":0')
  })

  test("minifies heterogeneous pretty JSON without changing its value", () => {
    const value = {
      items: [
        { id: 1, name: "alpha", tags: ["x", "y"] },
        { id: 2, name: "beta", tags: ["z"] },
        { id: 3, name: "gamma", tags: [] },
        { id: 4, name: "delta", tags: ["w", "v", "u"] },
        { id: 5, name: "epsilon", tags: ["t"] },
      ],
      note: "x".repeat(300),
    }
    const text = JSON.stringify(value, null, 4)
    const result = compressToolOutputText(text)
    expect(result).toBeDefined()
    expect(JSON.parse(result?.text as string)).toEqual(value)
  })

  test("leaves small JSON alone", () => {
    expect(compressToolOutputText(JSON.stringify({ ok: true }))).toBeUndefined()
  })

  test("compressJsonValue collapses only similar arrays", () => {
    const mixed = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? { a: i } : { b: i, c: i }))
    expect(compressJsonValue(mixed).changed).toBe(false)
    const uniform = Array.from({ length: 20 }, (_, i) => ({ a: i }))
    const collapsed = compressJsonValue(uniform)
    expect(collapsed.changed).toBe(true)
    expect((collapsed.value as Array<unknown>).length).toBeLessThan(20)
  })
})

describe("compressToolOutputText — log", () => {
  test("collapses repeated lines with a count and drops progress lines", () => {
    const result = compressToolOutputText(noisyLog())
    expect(result).toBeDefined()
    expect(result?.kinds).toContain("log")
    expect(result?.text).toContain("compiling module chunk")
    expect(result?.text).toContain("repeated 119 more times")
    expect(result?.text).not.toContain("42% |")
    expect(result?.text).toContain("done in 4s")
  })

  test("error lines inside a compressed log stay byte-for-byte and never collapse", () => {
    const text = [...Array(60).fill("error: same failure repeated"), ...Array(60).fill("plain work line")].join("\n")
    const result = compressToolOutputText(text)
    expect(result).toBeDefined()
    // Every copy of the error line survives, unaltered.
    expect(result?.text.split("\n").filter((line) => line === "error: same failure repeated")).toHaveLength(60)
    expect(result?.text).toContain("plain work line")
    expect(result?.text).toContain("repeated 59 more times")
  })
})

describe("compressToolOutputText — diff", () => {
  const fileDiff = (file: string, body: string) =>
    [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -1,12 +1,12 @@", body].join("\n")

  test("deduplicates identical file sections and preserves changed lines", () => {
    const body = [" context one", " context two", " context three", " context four", " context five", " context six", "-old line", "+new line"].join("\n")
    const text = [fileDiff("a.ts", body), fileDiff("b.ts", body.replace("old line", "other").replace("new line", "fresh")), fileDiff("a.ts", body)].join("\n")
    const result = compressToolOutputText(text)
    expect(result).toBeDefined()
    expect(result?.kinds).toContain("diff")
    expect(result?.text).toContain("identical diff for a.ts omitted")
    expect(result?.text).toContain("-old line")
    expect(result?.text).toContain("+fresh")
    expect(result?.text).toContain("unchanged lines")
  })
})

describe("compressToolOutputText — search", () => {
  test("caps matches per file, dedupes lines, and reports omissions", () => {
    const lines: Array<string> = []
    for (let i = 1; i <= 12; i++) lines.push(`src/big.ts:${i}:match number ${i}`)
    for (let i = 1; i <= 4; i++) lines.push(`src/small.ts:${i}:small match ${i}`)
    lines.push("src/big.ts:1:match number 1")
    const result = compressToolOutputText(lines.join("\n"))
    expect(result).toBeDefined()
    expect(result?.kinds).toContain("search")
    expect(result?.text).toContain("more matches in src/big.ts omitted")
    expect(result?.text).toContain("duplicate match lines omitted")
    expect(result?.text).toContain("src/small.ts:4:small match 4")
    expect(result?.text.split("\n").filter((line) => line.startsWith("src/big.ts:"))).toHaveLength(6)
  })
})

describe("compressToolOutputText — generic", () => {
  test("head/tails a long line-based output and keeps middle error lines verbatim", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `unique content line ${i} with some padding text`)
    lines[150] = "error: the one important failure in the middle"
    const result = compressToolOutputText(lines.join("\n"))
    expect(result).toBeDefined()
    expect(result?.kinds).toContain("generic")
    expect(result?.text).toContain("lines omitted")
    expect(result?.text).toContain("error: the one important failure in the middle")
    expect(result?.text).toContain("unique content line 0")
    expect(result?.text).toContain("unique content line 299")
    expect(result?.text).not.toContain("unique content line 100")
  })

  test("head/tails a single huge line by characters", () => {
    const text = `HEAD${"a".repeat(20_000)}TAIL`
    const result = compressToolOutputText(text)
    expect(result).toBeDefined()
    expect(result?.text).toContain("chars omitted")
    expect(result?.text.startsWith("HEAD")).toBe(true)
    expect(result?.text.endsWith("TAIL")).toBe(true)
  })

  test("read-tool numbered envelope: JSON payload compresses structurally", () => {
    const raw = jsonRows(30)
    const numbered = raw
      .split("\n")
      .map((line, i) => `${i + 1}: ${line}`)
      .join("\n")
    const text = `Read file /repo/data.json, lines 1-100\n${numbered}`
    const result = compressToolOutputText(text)
    expect(result).toBeDefined()
    expect(result?.kinds).toContain("json")
    expect(result?.text).toContain("Read file /repo/data.json")
    expect(result?.text).toContain("similar items omitted")
  })

  test("read-tool numbered envelope: log payload collapses repeats, error line kept", () => {
    const body = [...Array(60).fill("INFO worker heartbeat ok"), "ERROR worker 2 failed to heartbeat at tick 299"]
    const text = body.map((line, i) => `${i + 1}: ${line}`).join("\n")
    const result = compressToolOutputText(text)
    expect(result).toBeDefined()
    expect(result?.kinds).toContain("log")
    expect(result?.text).toContain("ERROR worker 2 failed to heartbeat at tick 299")
    expect(result?.text).toContain("repeated 59 more times")
  })

  test("leaves an unrecognized moderate shape alone", () => {
    const prose = Array.from({ length: 25 }, (_, i) => `A distinct sentence number ${i} about nothing in particular.`).join("\n")
    expect(compressToolOutputText(prose)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Verbatim rules at the history level
// ---------------------------------------------------------------------------

describe("compressHistory — verbatim rules", () => {
  test("never compresses the most recent tool outputs", () => {
    const messages = [
      Message.user("task"),
      toolCall("c1", "bash"),
      toolOutput("c1", "bash", noisyLog()),
      toolCall("c2", "bash"),
      toolOutput("c2", "bash", noisyLog()),
      toolCall("c3", "bash"),
      toolOutput("c3", "bash", noisyLog()),
      toolCall("c4", "bash"),
      toolOutput("c4", "bash", noisyLog()),
      toolCall("c5", "bash"),
      toolOutput("c5", "bash", noisyLog()),
      Message.user("next"),
    ]
    const report = compressHistory(messages, { budgetBytes: 1_000 })
    expect(report.compressed).toBe(true)
    // Only the oldest output (c1) is outside the protected recent four.
    expect(outputText(report.messages[2])).toContain("repeated")
    for (const index of [4, 6, 8, 10]) expect(outputText(report.messages[index])).toBe(noisyLog())
  })

  test("a large log containing error lines still compresses, error lines verbatim", () => {
    const lines: Array<string> = []
    for (let block = 0; block < 20; block++) {
      for (let i = 0; i < 60; i++) lines.push("INFO worker heartbeat ok")
      if (block < 7) lines.push(`ERROR worker ${block} failed to heartbeat at tick ${block}`)
      for (let i = 0; i < 30; i++) lines.push(`INFO processed batch ${block * 100 + i} in 3ms`)
    }
    const messages = [
      Message.user("task"),
      toolCall("c1", "read"),
      toolOutput("c1", "read", lines.join("\n")),
      ...fillers(60),
      Message.user("next"),
    ]
    const report = compressHistory(messages, { budgetBytes: 1_000 })
    expect(report.compressed).toBe(true)
    const text = outputText(report.messages[2])
    for (let block = 0; block < 7; block++) {
      expect(text).toContain(`ERROR worker ${block} failed to heartbeat at tick ${block}`)
    }
  })

  test("never compresses an output bearing error signals", () => {
    const failing = ["step one", ...Array(80).fill("retrying request"), "exit code: 1"].join("\n")
    const messages = [
      Message.user("task"),
      toolCall("c1", "bash"),
      toolOutput("c1", "bash", failing),
      toolCall("c2", "bash"),
      toolOutput("c2", "bash", noisyLog()),
      ...fillers(10),
      Message.user("next"),
    ]
    const report = compressHistory(messages, { budgetBytes: 1_000 })
    expect(outputText(report.messages[2])).toBe(failing)
    expect(outputText(report.messages[4])).toContain("repeated")
  })

  test("never compresses error-type results or outputs after the latest user message", () => {
    const errorPart = Message.make({
      role: "tool",
      content: [
        {
          type: "tool-result",
          id: "c1",
          name: "bash",
          result: { type: "error", value: { message: "boom" } },
        },
      ],
    })
    const messages = [
      Message.user("task"),
      toolCall("c1", "bash"),
      errorPart,
      toolCall("c2", "bash"),
      toolOutput("c2", "bash", noisyLog()),
      Message.user("latest"),
      toolCall("c3", "bash"),
      toolOutput("c3", "bash", noisyLog()),
    ]
    const report = compressHistory(messages, { budgetBytes: 1_000 })
    expect(report.messages[2]).toBe(errorPart)
    // c2 sits before the latest user message and outside the recent four? No —
    // the recent four includes c3 and c2 is 2 outputs back, so protection here
    // comes from the tail rule only for c3; c2 may compress. What must hold:
    // everything from the latest user message onward is byte-identical.
    expect(outputText(report.messages[7])).toBe(noisyLog())
    expect(report.messages[5]).toBe(messages[5])
  })

  test("never touches user or assistant text and never mutates the input", () => {
    const repeated = Array(200).fill("assistant reasoning line").join("\n")
    const assistant = Message.make({ role: "assistant", content: [{ type: "text", text: repeated }] })
    const original = noisyLog()
    const messages = [
      Message.user("task"),
      assistant,
      toolCall("c1", "bash"),
      toolOutput("c1", "bash", original),
      ...fillers(20),
      Message.user("next"),
    ]
    const report = compressHistory(messages, { budgetBytes: 1_000 })
    expect(report.compressed).toBe(true)
    expect(report.messages[1]).toBe(assistant)
    // The transform rebuilt the report's copy; the caller's array is untouched.
    expect(outputText(report.messages[3])).toContain("repeated")
    expect(outputText(messages[3])).toBe(original)
  })
})

// ---------------------------------------------------------------------------
// Trigger / budget / backstop
// ---------------------------------------------------------------------------

describe("compressHistory — trigger and backstop", () => {
  test("under budget returns the identical array", () => {
    const messages = [Message.user("hi"), toolCall("c1", "bash"), toolOutput("c1", "bash", noisyLog())]
    const report = compressHistory(messages)
    expect(report.compressed).toBe(false)
    expect(report.messages).toBe(messages)
    expect(report.bytesBefore).toBeLessThanOrEqual(DEFAULT_COMPRESSION_BUDGET_BYTES)
  })

  test("compresses in a single-prompt run shape (user message only at the head)", () => {
    // Real run histories are [user, assistant, tool, assistant, tool, …]:
    // the latest user message is the FIRST message. Eligibility must not
    // exempt everything after it — only the recency tail is protected.
    const messages = [
      Message.user("task"),
      toolCall("c1", "bash"),
      toolOutput("c1", "bash", noisyLog()),
      ...fillers(70),
    ]
    const report = compressHistory(messages, { budgetBytes: 1_000 })
    expect(report.compressed).toBe(true)
    expect(outputText(report.messages[2])).toContain("repeated")
  })

  test("tombstone backstop also fires in the single-prompt shape", () => {
    const chunk = "prose ".repeat(1_040)
    const messages: Array<Message> = [Message.user("task")]
    for (let i = 0; i < 55; i++) messages.push(toolCall(`c${i}`, "read"), toolOutput(`c${i}`, "read", chunk))
    const report = compressHistory(messages, { budgetBytes: 120_000 })
    expect(report.truncated).toBe(true)
    expect(report.bytesAfter).toBeLessThanOrEqual(200_000)
  })

  test("compresses oldest first and stops once under budget", () => {
    const messages = [
      Message.user("task"),
      toolCall("c1", "bash"),
      toolOutput("c1", "bash", noisyLog(60)),
      toolCall("c2", "bash"),
      toolOutput("c2", "bash", noisyLog(60)),
      ...fillers(30),
      Message.user("next"),
    ]
    const total = JSON.stringify(messages).length
    const firstOnly = JSON.stringify([messages[0], messages[1], messages[2]]).length
    // Budget that the first compression alone can satisfy.
    const budget = total - Math.floor(firstOnly / 2)
    const report = compressHistory(messages, { budgetBytes: budget })
    expect(report.compressed).toBe(true)
    expect(report.partsCompressed).toBe(1)
    expect(outputText(report.messages[2])).toContain("repeated")
    expect(outputText(report.messages[4])).toBe(noisyLog(60))
  })

  test("when compression cannot reach the budget but stays under the hard cap, no tombstones fire", () => {
    // 30 parts of unique single-line prose: nothing any compressor can shrink.
    const chunk = (i: number) => `unique prose chunk ${i} ` + "lorem ipsum dolor sit amet ".repeat(190) + `end ${i}`
    const messages: Array<Message> = [Message.user("task")]
    for (let i = 0; i < 30; i++) {
      messages.push(toolCall(`c${i}`, "read"), toolOutput(`c${i}`, "read", chunk(i)))
    }
    messages.push(Message.user("next"))
    const report = compressHistory(messages)
    expect(JSON.stringify(messages).length).toBeGreaterThan(DEFAULT_COMPRESSION_BUDGET_BYTES)
    expect(report.compressed).toBe(false)
    expect(report.truncated).toBe(false)
    expect(report.messages).toBe(messages)
  })

  test("tombstone backstop still fires when compression cannot prevent the hard cap", () => {
    const chunk = (i: number) => `unique prose chunk ${i} ` + "lorem ipsum dolor sit amet ".repeat(190) + `end ${i}`
    const messages: Array<Message> = [Message.user("task")]
    for (let i = 0; i < 55; i++) {
      messages.push(toolCall(`c${i}`, "read"), toolOutput(`c${i}`, "read", chunk(i)))
    }
    messages.push(Message.user("next"))
    expect(JSON.stringify(messages).length).toBeGreaterThan(256 * 1024)
    const report = compressHistory(messages)
    expect(report.truncated).toBe(true)
    expect(report.truncatedParts).toBeGreaterThan(0)
    expect(report.bytesAfter).toBeLessThanOrEqual(200_000)
    expect(JSON.stringify(report.messages).length).toBeLessThanOrEqual(200_000)
  })

  test("structured json results compress in place and keep their type", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: i, name: `row-${i}`, value: i }))
    const part = Message.make({
      role: "tool",
      content: [{ type: "tool-result", id: "c1", name: "query", result: { type: "json", value: { rows } } }],
    })
    const messages = [
      Message.user("task"),
      toolCall("c1", "query"),
      part,
      ...fillers(40),
      Message.user("next"),
    ]
    const report = compressHistory(messages, { budgetBytes: 1_000 })
    expect(report.compressed).toBe(true)
    expect(report.byKind.json).toBe(1)
    const resultPart = report.messages[2]?.content[0]
    if (resultPart?.type !== "tool-result" || resultPart.result.type !== "json") throw new Error("expected json result")
    const value = resultPart.result.value as { rows: Array<unknown> }
    expect(value.rows.length).toBeLessThan(40)
  })
})

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("resolveContextCompression", () => {
  test("defaults off, env can force on and off, kill switch wins", () => {
    expect(resolveContextCompression(undefined, {}).enabled).toBe(false)
    expect(resolveContextCompression(undefined, { GRIST_CONTEXT_COMPRESSION: "1" }).enabled).toBe(true)
    expect(resolveContextCompression(undefined, { GRIST_CONTEXT_COMPRESSION: "0" }).enabled).toBe(false)
    expect(resolveContextCompression(undefined, { GRIST_CONTEXT_COMPRESSION: "1", GRIST_CTRL: "off" }).enabled).toBe(false)
    expect(resolveContextCompression(undefined, {}).budgetBytes).toBe(DEFAULT_COMPRESSION_BUDGET_BYTES)
  })

  test("per-repo state file opts in and sets the budget, env overrides the file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grist-cc-config-"))
    const file = contextCompressionConfigPath(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ enabled: true, budgetBytes: 90_000 }))
    const fromFile = resolveContextCompression(dir, {})
    expect(fromFile.enabled).toBe(true)
    expect(fromFile.source).toBe("file")
    expect(fromFile.budgetBytes).toBe(90_000)
    expect(resolveContextCompression(dir, { GRIST_CONTEXT_COMPRESSION: "0" }).enabled).toBe(false)
    fs.writeFileSync(file, JSON.stringify({ enabled: true, budgetBytes: 10 }))
    fs.utimesSync(file, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000))
    expect(resolveContextCompression(dir, {}).budgetBytes).toBe(MIN_COMPRESSION_BUDGET_BYTES)
    fs.writeFileSync(file, JSON.stringify({ enabled: true, budgetBytes: 9_999_999 }))
    fs.utimesSync(file, new Date(Date.now() + 120_000), new Date(Date.now() + 120_000))
    expect(resolveContextCompression(dir, {}).budgetBytes).toBe(MAX_COMPRESSION_BUDGET_BYTES)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

describe("compression stats", () => {
  test("session totals accumulate measured reports and journal to disk", () => {
    const messages = [
      Message.user("task"),
      toolCall("c1", "bash"),
      toolOutput("c1", "bash", noisyLog()),
      ...fillers(50),
      Message.user("next"),
    ]
    const report = compressHistory(messages, { budgetBytes: 1_000 })
    expect(report.compressed).toBe(true)
    const totals = recordCompressionReport("ses_stats_test", report)
    expect(totals.requests).toBe(1)
    expect(totals.partsCompressed).toBe(report.partsCompressed)
    expect(totals.bytesSaved).toBe(report.bytesBefore - report.bytesAfter)
    expect(totals.byKind.log).toBeGreaterThan(0)

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grist-cc-stats-"))
    appendCompressionSessionRecord(dir, "ses_stats_test", totals)
    const records = readCompressionSessionRecords(dir)
    expect(records).toHaveLength(1)
    expect(records[0]?.sessionID).toBe("ses_stats_test")
    expect(records[0]?.bytesSaved).toBe(totals.bytesSaved)
    expect(fs.existsSync(compressionStatsPath(dir))).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
