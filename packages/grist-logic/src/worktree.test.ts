import { describe, expect, test } from "bun:test"
import {
  isWorktreeDirectory,
  managedWorktrees,
  normalizeWorktreeDir,
  planWorktreeCleanup,
  threadBranchName,
  threadWorktree,
  type ProjectWorktrees,
  type ThreadWorktreeRef,
} from "./worktree"

describe("threadBranchName", () => {
  test("slugs the title and suffixes the short id", () => {
    expect(threadBranchName({ title: "Fix the Login Bug!", id: "ses_abc123XYZ789" })).toBe("grist/fix-the-login-bug-xyz789")
  })

  test("falls back to the short id without a title", () => {
    expect(threadBranchName({ id: "draft-42" })).toBe("grist/raft42")
  })

  test("caps the slug length and stays a valid ref", () => {
    const name = threadBranchName({ title: "a ".repeat(40).trim(), id: "ses_000001" })
    expect(name.startsWith("grist/")).toBe(true)
    expect(name).not.toContain("..")
    expect(name.length).toBeLessThanOrEqual("grist/".length + 32 + 1 + 6)
  })
})

describe("normalizeWorktreeDir", () => {
  test("drops trailing slashes and dot segments", () => {
    expect(normalizeWorktreeDir("/repo/./wt/")).toBe("/repo/wt")
    expect(normalizeWorktreeDir("/repo/a/../wt")).toBe("/repo/wt")
  })
})

const projects: ProjectWorktrees[] = [
  {
    projectID: "prj_1",
    entries: [
      { directory: "/repo", strategy: undefined },
      { directory: "/data/worktree/prj1/alpha", strategy: "git" },
      { directory: "/data/worktree/prj1/beta", strategy: "git" },
      { directory: "/data/worktree/prj1/gamma", strategy: "git" },
    ],
  },
]

describe("managedWorktrees", () => {
  test("keeps only strategy-owned entries", () => {
    expect(managedWorktrees(projects[0].entries).map((entry) => entry.directory)).toEqual([
      "/data/worktree/prj1/alpha",
      "/data/worktree/prj1/beta",
      "/data/worktree/prj1/gamma",
    ])
  })
})

describe("threadWorktree", () => {
  test("matches a thread to its managed worktree, tolerating trailing slashes", () => {
    const thread: ThreadWorktreeRef = { id: "ses_1", directory: "/data/worktree/prj1/alpha/" }
    expect(threadWorktree(thread, projects)).toEqual({ projectID: "prj_1", directory: "/data/worktree/prj1/alpha" })
  })

  test("a thread in the project root has no worktree", () => {
    expect(threadWorktree({ id: "ses_2", directory: "/repo" }, projects)).toBeUndefined()
  })
})

describe("isWorktreeDirectory", () => {
  test("matches sandbox directories, normalized", () => {
    expect(isWorktreeDirectory("/data/worktree/prj1/alpha/", ["/data/worktree/prj1/alpha"])).toBe(true)
    expect(isWorktreeDirectory("/repo", ["/data/worktree/prj1/alpha"])).toBe(false)
    expect(isWorktreeDirectory(undefined, ["/data/worktree/prj1/alpha"])).toBe(false)
  })
})

describe("planWorktreeCleanup", () => {
  const threads: ThreadWorktreeRef[] = [
    { id: "ses_a", directory: "/data/worktree/prj1/alpha", archivedAt: 100 },
    { id: "ses_b", directory: "/data/worktree/prj1/beta" },
    { id: "ses_c", directory: "/data/worktree/prj1/beta", archivedAt: 100 },
  ]

  test("plans worktrees whose threads are all archived", () => {
    expect(planWorktreeCleanup(threads, projects)).toEqual([
      { projectID: "prj_1", directory: "/data/worktree/prj1/alpha", reason: "archived" },
    ])
  })

  test("a live resident protects the worktree", () => {
    const plan = planWorktreeCleanup(threads, projects)
    expect(plan.map((item) => item.directory)).not.toContain("/data/worktree/prj1/beta")
  })

  test("orphans are excluded unless opted in", () => {
    expect(planWorktreeCleanup(threads, projects).map((item) => item.directory)).not.toContain("/data/worktree/prj1/gamma")
    expect(planWorktreeCleanup(threads, projects, { includeOrphans: true })).toContainEqual({
      projectID: "prj_1",
      directory: "/data/worktree/prj1/gamma",
      reason: "orphaned",
    })
  })

  test("the project root is never planned", () => {
    const plan = planWorktreeCleanup([{ id: "ses_r", directory: "/repo", archivedAt: 1 }], projects, {
      includeOrphans: true,
    })
    expect(plan.map((item) => item.directory)).not.toContain("/repo")
  })
})
