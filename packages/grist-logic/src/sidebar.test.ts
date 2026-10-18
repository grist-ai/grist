import { describe, expect, test } from "bun:test"
import { groupThreadsByProject, summaryFromSessionInfo, threadBadge, type SessionInfoLike } from "./sidebar.js"

const info = (over: Partial<SessionInfoLike> = {}): SessionInfoLike => ({
  id: "ses_1",
  projectID: "prj_1",
  title: "Fix login",
  cost: 0.5,
  time: { created: 100, updated: 200 },
  location: { directory: "/home/user/website" },
  ...over,
})

describe("summaryFromSessionInfo", () => {
  test("outcome wins; no idle timestamp means running", () => {
    expect(summaryFromSessionInfo(info({ outcome: "succeeded" })).status).toBe("succeeded")
    expect(summaryFromSessionInfo(info()).status).toBe("running")
    expect(summaryFromSessionInfo(info({ time: { created: 1, updated: 2, idle: 3 } })).status).toBe("idle")
  })

  test("carries title, directory, cost, and view timestamps", () => {
    const summary = summaryFromSessionInfo(info({ time: { created: 1, updated: 500, viewed: 400 } }))
    expect(summary).toMatchObject({ title: "Fix login", directory: "/home/user/website", totalCost: 0.5, updatedAt: 500, viewedAt: 400 })
  })
})

describe("threadBadge", () => {
  test("unread when updated after viewed (or never viewed); attention from pending requests", () => {
    const summary = summaryFromSessionInfo(info({ time: { created: 1, updated: 500, viewed: 400 } }))
    expect(threadBadge(summary, 0).unread).toBe(true)
    expect(threadBadge(summary, 2)).toMatchObject({ pendingRequests: 2, needsAttention: true })
    const seen = summaryFromSessionInfo(info({ time: { created: 1, updated: 500, viewed: 600 } }))
    expect(threadBadge(seen, 0).unread).toBe(false)
  })
})

describe("groupThreadsByProject", () => {
  test("groups by project, labels by directory basename, orders groups by activity", () => {
    const threads = [
      summaryFromSessionInfo(info({ id: "a", time: { created: 1, updated: 100 } })),
      summaryFromSessionInfo(info({ id: "b", projectID: "prj_2", location: { directory: "/srv/api" }, time: { created: 1, updated: 900 } })),
      summaryFromSessionInfo(info({ id: "c", outcome: "succeeded", time: { created: 1, updated: 300, idle: 300 } })),
    ]
    const groups = groupThreadsByProject(threads, new Map([["a", 1]]))
    expect(groups.map((g) => g.label)).toEqual(["api", "website"])
    expect(groups[1].threads.map((t) => t.id)).toEqual(["a", "c"]) // running before succeeded
    expect(groups[1].pendingRequests).toBe(1)
    expect(groups[1].unreadCount).toBe(2)
  })

  test("archived threads are excluded unless requested", () => {
    const threads = [summaryFromSessionInfo(info({ time: { created: 1, updated: 2, archived: 5 } }))]
    expect(groupThreadsByProject(threads)).toEqual([])
    expect(groupThreadsByProject(threads, new Map(), { includeArchived: true })[0].threads).toHaveLength(1)
  })
})
