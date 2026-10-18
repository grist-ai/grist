import { describe, expect, test } from "bun:test"
import {
  approvalItemFromGateDecision,
  itemFromSessionEvent,
  itemsFromStoredMessages,
  orderThreads,
  projectThread,
  statusFromStoredMessages,
  summaryFromStoredRow,
} from "./thread-model.js"

const ev = (type: string, data: Record<string, unknown> = {}) => ({ type, data })

describe("itemFromSessionEvent", () => {
  test("maps the durable item-bearing events", () => {
    expect(itemFromSessionEvent(ev("session.text.ended", { assistantMessageID: "m1", text: "done" }))).toEqual({
      kind: "message",
      messageID: "m1",
      text: "done",
    })
    expect(itemFromSessionEvent(ev("session.tool.called", { id: "t1", name: "edit" }))?.kind).toBe("tool")
    expect(itemFromSessionEvent(ev("session.tool.failed", { id: "t1", name: "edit", error: { message: "nope" } }))).toMatchObject({
      kind: "tool",
      phase: "failed",
      error: "nope",
    })
    expect(itemFromSessionEvent(ev("session.step.ended", { cost: 0.5, files: ["a.ts"] }))).toMatchObject({
      kind: "step",
      cost: 0.5,
      files: ["a.ts"],
    })
    expect(itemFromSessionEvent(ev("session.execution.failed"))).toEqual({ kind: "outcome", status: "failed" })
  })

  test("ephemeral deltas and unmapped events produce no item", () => {
    expect(itemFromSessionEvent(ev("session.text.delta", { delta: "x" }))).toBeUndefined()
    expect(itemFromSessionEvent(ev("session.reasoning.delta", { delta: "x" }))).toBeUndefined()
    expect(itemFromSessionEvent(ev("session.tool.input.delta", { delta: "x" }))).toBeUndefined()
    expect(itemFromSessionEvent(ev("session.totally.unknown"))).toBeUndefined()
  })
})

describe("approvalItemFromGateDecision", () => {
  test("ask_human decisions become approval requests; other routes do not", () => {
    expect(approvalItemFromGateDecision({ route: "ask_human", reason: "ambiguous", rung: "cheapest" })).toEqual({
      kind: "approval_request",
      source: "jev_gate",
      reason: "ambiguous",
      rung: "cheapest",
    })
    expect(approvalItemFromGateDecision({ route: "run" })).toBeUndefined()
  })
})

describe("projectThread", () => {
  test("folds a session's events into summary + items", () => {
    const { summary, items } = projectThread("ses_1", [
      ev("session.created", { projectID: "prj_1", title: "Fix login" }),
      ev("session.execution.started"),
      ev("session.step.ended", { cost: 0.25 }),
      ev("session.text.ended", { text: "working" }),
      ev("session.tool.success", { id: "t1", name: "edit" }),
      ev("session.step.ended", { cost: 0.75 }),
      ev("session.execution.succeeded"),
    ])
    expect(summary).toMatchObject({
      id: "ses_1",
      projectID: "prj_1",
      title: "Fix login",
      status: "succeeded",
      stepCount: 2,
      totalCost: 1,
    })
    expect(items.map((i) => i.kind)).toEqual(["lifecycle", "step", "message", "tool", "step", "outcome"])
    expect(summary.itemCount).toBe(items.length)
  })

  test("rename, fork, and viewed fold into the summary", () => {
    const { summary } = projectThread("ses_2", [
      ev("session.created", { title: "old" }),
      ev("session.renamed", { title: "new" }),
      ev("session.forked", { sourceSessionID: "ses_0" }),
      ev("session.viewed"),
    ])
    expect(summary.title).toBe("new")
    expect(summary.forkedFrom).toBe("ses_0")
    expect(summary.viewed).toBe(true)
    expect(summary.status).toBe("idle")
  })
})

describe("stored projection (replay source)", () => {
  const stored = [
    { type: "user", data: { content: [{ type: "text", text: "fix it" }] } },
    {
      type: "assistant",
      data: {
        cost: 0.42,
        snapshot: { files: ["src/greet.ts"] },
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "tool", id: "t1", name: "edit", state: { status: "completed", input: {} } },
          { type: "tool", id: "t2", name: "bash", state: { status: "error", error: { message: "boom" } } },
          { type: "text", text: "done" },
        ],
      },
    },
    { type: "idle", data: { outcome: "succeeded" } },
  ]

  test("stored messages project to the same item shapes as live events", () => {
    const items = itemsFromStoredMessages(stored)
    expect(items.map((i) => i.kind)).toEqual(["lifecycle", "reasoning", "tool", "tool", "message", "step", "outcome"])
    expect(items[2]).toMatchObject({ kind: "tool", name: "edit", phase: "success" })
    expect(items[3]).toMatchObject({ kind: "tool", name: "bash", phase: "failed", error: "boom" })
    expect(items[5]).toMatchObject({ kind: "step", cost: 0.42, files: ["src/greet.ts"] })
  })

  test("status comes from the last idle outcome; summary from the session row", () => {
    expect(statusFromStoredMessages(stored)).toBe("succeeded")
    expect(statusFromStoredMessages([{ type: "user", data: {} }])).toBe("idle")
    const summary = summaryFromStoredRow(
      { id: "ses_9", title: "Fix login", directory: "/repo", project_id: "prj_1", cost: 1.5 },
      "succeeded",
      3,
      7,
    )
    expect(summary).toMatchObject({ id: "ses_9", title: "Fix login", directory: "/repo", totalCost: 1.5, stepCount: 3, itemCount: 7 })
  })
})

describe("orderThreads", () => {
  test("running first, then by recency", () => {
    const mk = (id: string, status: "running" | "succeeded" | "idle", lastSeq: number) => ({
      summary: { id, status, totalCost: 0, stepCount: 0, itemCount: 0 },
      lastSeq,
    })
    const ordered = orderThreads([mk("a", "succeeded", 99), mk("b", "running", 1), mk("c", "idle", 50)])
    expect(ordered.map((t) => t.summary.id)).toEqual(["b", "c", "a"])
  })
})
