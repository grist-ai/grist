import { describe, expect, test } from "bun:test"
import { memoryForConversation, postedItemFromThreadItem, postedStream } from "./conversation-stream.js"
import type { StoredMessage } from "./thread-model.js"

const msg = (type: string, data: Record<string, unknown> = {}): StoredMessage => ({ type, data })

const sessionOne: StoredMessage[] = [
  msg("user", { text: "Fix the greeting" }),
  msg("assistant", {
    content: [
      { type: "reasoning", text: "let me look at the file first" },
      { type: "text", text: "Fixing the greeting now." },
      { type: "tool", id: "t1", name: "edit", state: { status: "completed" } },
    ],
    snapshot: { files: ["src/greet.ts"] },
    cost: 0.1,
  }),
  msg("shell", { command: "bun test", status: "completed", exit: 0 }),
  msg("idle", { outcome: "succeeded" }),
]

const sessionTwo: StoredMessage[] = [
  msg("user", { text: "Now add a test for it" }),
  msg("assistant", {
    content: [{ type: "text", text: "Added greet.test.ts and it passes." }],
    snapshot: { files: ["src/greet.test.ts"] },
    cost: 0.05,
  }),
  msg("idle", { outcome: "succeeded" }),
]

describe("postedStream", () => {
  test("two sessions render one continuous stream with no inspect-only detail", () => {
    const stream = postedStream([
      { sessionID: "ses_1", messages: sessionOne },
      { sessionID: "ses_2", messages: sessionTwo },
    ])
    expect(stream.map((item) => item.kind)).toEqual([
      "user",
      "message",
      "files",
      "outcome",
      "user",
      "message",
      "files",
      "outcome",
    ])
    expect(stream.map((item) => item.sessionID)).toEqual([
      "ses_1",
      "ses_1",
      "ses_1",
      "ses_1",
      "ses_2",
      "ses_2",
      "ses_2",
      "ses_2",
    ])
    expect(stream[0]).toEqual({ kind: "user", sessionID: "ses_1", text: "Fix the greeting" })
    expect(stream[2]).toEqual({ kind: "files", sessionID: "ses_1", files: ["src/greet.ts"] })
    // The tool call, the reasoning, and the shell run from session one are
    // inspect-view detail: none of them may appear in the posted stream.
    const serialized = JSON.stringify(stream)
    expect(serialized).not.toContain("let me look at the file first")
    expect(serialized).not.toContain("bun test")
    expect(serialized).not.toContain('"tool"')
  })

  test("empty assistant text and file-less steps post nothing", () => {
    const stream = postedStream([
      {
        sessionID: "ses_1",
        messages: [
          msg("assistant", { content: [{ type: "tool", id: "t1", name: "read", state: { status: "completed" } }] }),
        ],
      },
    ])
    expect(stream).toEqual([])
  })
})

describe("postedItemFromThreadItem", () => {
  test("questions and lifecycle notes post; reasoning, tool, shell, compaction, usage do not", () => {
    expect(
      postedItemFromThreadItem("ses_1", { kind: "approval_request", source: "jev_gate", reason: "ambiguous" }),
    ).toEqual({ kind: "question", sessionID: "ses_1", reason: "ambiguous", rung: undefined })
    expect(postedItemFromThreadItem("ses_1", { kind: "lifecycle", event: "session.renamed" })).toEqual({
      kind: "lifecycle",
      sessionID: "ses_1",
      event: "session.renamed",
    })
    expect(postedItemFromThreadItem("ses_1", { kind: "reasoning", text: "hmm" })).toBeUndefined()
    expect(postedItemFromThreadItem("ses_1", { kind: "tool", name: "edit", phase: "success" })).toBeUndefined()
    expect(postedItemFromThreadItem("ses_1", { kind: "shell", phase: "ended" })).toBeUndefined()
    expect(postedItemFromThreadItem("ses_1", { kind: "compaction", phase: "ended" })).toBeUndefined()
    expect(postedItemFromThreadItem("ses_1", { kind: "usage", cost: 1 })).toBeUndefined()
  })
})

describe("memoryForConversation", () => {
  test("keeps exactly the entries captured in the conversation's sessions, in store order", () => {
    const records = [
      { id: "m3", sessionID: "ses_2", content: "newest, from session two" },
      { id: "m2", sessionID: "ses_9", content: "someone else's session" },
      { id: "m1", sessionID: "ses_1", content: "oldest, from session one" },
      { id: "m0", content: "no session provenance" },
    ]
    expect(memoryForConversation(records, ["ses_1", "ses_2"]).map((record) => record.id)).toEqual(["m3", "m1"])
    expect(memoryForConversation(records, [])).toEqual([])
  })
})
