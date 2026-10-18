import { describe, expect, test } from "bun:test"
import { applyDream, planDream } from "./dreaming.js"
import type { MemoryRecord } from "./types.js"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 18)
let seq = 0
function rec(partial: Partial<MemoryRecord>): MemoryRecord {
  seq += 1
  return {
    id: `m${seq}`,
    content: "fact",
    container: "repo",
    outcome: "tests_passed",
    weight: 0.75,
    createdAt: NOW - DAY,
    ...partial,
  }
}

describe("planDream", () => {
  test("merges near-duplicates, keeping the stronger record", () => {
    const a = rec({ content: "Tests run with bun test in this repo", weight: 0.9 })
    const b = rec({ content: "tests run with bun test in this repo!", weight: 0.75 })
    const plan = planDream([a, b], NOW)
    expect(plan.merges).toHaveLength(1)
    expect(plan.merges[0]?.keepID).toBe(a.id)
    const applied = applyDream([a, b], plan, { now: NOW })
    expect(applied).toHaveLength(1)
    expect(applied[0]?.metadata?.citations).toBe("2")
  })

  test("archives stale records by decay + age", () => {
    const old = rec({ createdAt: NOW - 200 * DAY, weight: 0.5 })
    const fresh = rec({ createdAt: NOW - DAY, content: "fresh fact" })
    const plan = planDream([old, fresh], NOW)
    expect(plan.archives).toEqual([{ id: old.id, reason: "stale" }])
  })

  test("newer success supersedes an older failure with the same signature", () => {
    const fail = rec({ outcome: "check_failed", createdAt: NOW - 10 * DAY, metadata: { signature: "sig1", tool: "edit" }, content: "trap" })
    const win = rec({ outcome: "tests_passed", createdAt: NOW - DAY, metadata: { signature: "sig1" }, content: "fixed" })
    const plan = planDream([fail, win], NOW)
    expect(plan.archives).toContainEqual({ id: fail.id, reason: "superseded" })
    expect(plan.contradictions).toHaveLength(0)
  })

  test("failure after success is a contradiction — both kept, flagged", () => {
    const win = rec({ outcome: "tests_passed", createdAt: NOW - 10 * DAY, metadata: { signature: "sig2" }, content: "fixed" })
    const fail = rec({ outcome: "check_failed", createdAt: NOW - DAY, metadata: { signature: "sig2", tool: "edit" }, content: "trap again" })
    const plan = planDream([win, fail], NOW)
    expect(plan.contradictions).toHaveLength(1)
    expect(plan.archives).toHaveLength(0)
  })

  test("synthesizes a pattern from a recurring failure across sessions", () => {
    const mk = (sessionID: string) =>
      rec({ outcome: "check_failed", metadata: { signature: "sigX", tool: "shell" }, sessionID, content: `trap ${sessionID}` })
    const plan = planDream([mk("s1"), mk("s2"), mk("s1")], NOW)
    expect(plan.patterns).toHaveLength(1)
    expect(plan.patterns[0]?.metadata?.kind).toBe("pattern")
  })

  test("restricted records are never touched", () => {
    const secret = rec({ content: "Tests run with bun test in this repo", metadata: { tier: "restricted" }, createdAt: NOW - 300 * DAY })
    const plan = planDream([secret], NOW)
    expect(plan.skippedRestricted).toBe(1)
    expect(plan.archives).toHaveLength(0)
    expect(applyDream([secret], plan, { now: NOW })).toHaveLength(1)
  })
})
