import { describe, expect, test } from "bun:test"
import {
  builtinAutomations,
  dueAutomations,
  isDue,
  parseAutomationStore,
  reviewQueue,
  type AutomationTemplate,
} from "./automation"
import type { ThreadSummary } from "./thread-model"

const template = (schedule: AutomationTemplate["schedule"]): AutomationTemplate => ({
  id: "t1",
  name: "T",
  prompt: "do it",
  directory: "/repo",
  schedule,
  worktree: false,
  enabled: true,
})

// 2026-10-19 is a Monday.
const MON_0800 = new Date(2026, 9, 19, 8, 0).getTime()
const MON_1000 = new Date(2026, 9, 19, 10, 0).getTime()
const TUE_1000 = new Date(2026, 9, 20, 10, 0).getTime()

describe("isDue", () => {
  test("never-run templates are due; disabled ones never are", () => {
    expect(isDue(template({ kind: "daily", at: "09:00" }), undefined, MON_0800)).toBe(true)
    expect(isDue({ ...template({ kind: "daily", at: "09:00" }), enabled: false }, undefined, MON_1000)).toBe(false)
  })

  test("interval: due once the interval has elapsed", () => {
    const t = template({ kind: "interval", everyMinutes: 60 })
    expect(isDue(t, MON_1000 - 30 * 60_000, MON_1000)).toBe(false)
    expect(isDue(t, MON_1000 - 61 * 60_000, MON_1000)).toBe(true)
  })

  test("daily: due after the time, only once per day", () => {
    const t = template({ kind: "daily", at: "09:00" })
    expect(isDue(t, MON_0800 - 86_400_000, MON_0800)).toBe(false)
    expect(isDue(t, MON_0800 - 86_400_000, MON_1000)).toBe(true)
    expect(isDue(t, MON_1000 - 60_000, MON_1000)).toBe(false)
    expect(isDue(t, MON_1000 - 60_000, TUE_1000)).toBe(true)
  })

  test("weekly: due on the weekday after the time, once per week", () => {
    const t = template({ kind: "weekly", weekday: 1, at: "09:00" })
    expect(isDue(t, MON_1000 - 7 * 86_400_000, MON_1000)).toBe(true)
    // A missed slot stays due (catch-up), but a run this week closes it.
    expect(isDue(t, MON_1000 - 7 * 86_400_000, TUE_1000)).toBe(true)
    expect(isDue(t, MON_1000 - 60_000, TUE_1000)).toBe(false)
    expect(isDue(t, MON_1000 - 60_000, TUE_1000 + 6 * 86_400_000)).toBe(true)
  })
})

describe("store + builtins", () => {
  test("round-trips and tolerates partial files", () => {
    const store = parseAutomationStore(JSON.stringify({ templates: builtinAutomations("/repo") }))
    expect(store.templates.map((t) => t.id)).toEqual(["failure-mining-digest", "dreaming-curation"])
    expect(store.lastRunAt).toEqual({})
    expect(dueAutomations(store, MON_1000)).toHaveLength(2)
  })
})

const thread = (over: Partial<ThreadSummary>): ThreadSummary => ({
  id: "s1",
  status: "idle",
  totalCost: 0,
  stepCount: 1,
  itemCount: 1,
  updatedAt: 100,
  viewedAt: 100,
  ...over,
})

describe("reviewQueue", () => {
  test("orders approvals, failures, interruptions, unreviewed", () => {
    const queue = reviewQueue(
      [
        thread({ id: "done", status: "succeeded", updatedAt: 200, viewedAt: 100 }),
        thread({ id: "bad", status: "failed", updatedAt: 300 }),
        thread({ id: "seen", status: "succeeded", updatedAt: 100, viewedAt: 100 }),
        thread({ id: "wait", status: "idle", updatedAt: 50 }),
        thread({ id: "run", status: "running", updatedAt: 400 }),
        thread({ id: "old", status: "failed", archivedAt: 1 }),
      ],
      { pendingApprovals: new Map([["wait", 2]]) },
    )
    expect(queue.map((item) => `${item.thread.id}:${item.reason}`)).toEqual([
      "wait:approval",
      "bad:failed",
      "done:unreviewed",
    ])
  })

  test("attaches automation origin", () => {
    const queue = reviewQueue([thread({ id: "auto1", status: "failed" })], {
      automationBySession: new Map([["auto1", "dreaming-curation"]]),
    })
    expect(queue[0].automationID).toBe("dreaming-curation")
  })
})
