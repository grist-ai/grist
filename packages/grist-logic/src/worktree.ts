/**
 * D2 — worktree-per-thread planning: the pure, tested half of Grist's
 * worktree isolation.
 *
 * The v2 runtime already ships the engine (protocol `server.worktree`
 * group, core `Worktree` service, git strategy, per-project inventory
 * persisted with strategy ownership). What it does not do:
 *
 *   - name a branch for a thread's worktree (creation is detached-HEAD
 *     only; the schema's `branch` input is just a start ref),
 *   - connect threads (D0 summaries) to the worktree inventory,
 *   - decide what may be cleaned up when a thread is archived.
 *
 * This module owns those decisions as pure functions over the D0 thread
 * summaries and the wire inventory (`Worktree.List` per project), so the
 * desktop, the CLI, and maintenance scripts all apply the same rules:
 *
 *   - branches are `grist/<title-slug>-<short id>` — valid git refs,
 *     recognizably Grist's, and traceable back to their thread;
 *   - a worktree is "managed" (removable) only when the inventory records
 *     a strategy for it — the engine enforces the same rule server-side,
 *     so cleanup can never remove a checkout Grist did not create;
 *   - cleanup is planned only for worktrees whose threads are ALL
 *     archived; orphaned worktrees (no thread references them) are
 *     included only when the caller opts in, because a just-created
 *     worktree has no session yet and must survive a racing sweep.
 */

export type WorktreeInventoryEntry = {
  directory: string
  strategy?: string
}

export type ProjectWorktrees = {
  projectID: string
  entries: readonly WorktreeInventoryEntry[]
}

export type ThreadWorktreeRef = {
  id: string
  directory?: string
  projectID?: string
  archivedAt?: number
}

/** Normalize a directory for comparison: forward slashes, no dot segments, no trailing slash. */
export function normalizeWorktreeDir(value: string): string {
  const replaced = value.replaceAll("\\", "/")
  const segments = replaced.split("/").reduce<string[]>((result, segment) => {
    if (!segment || segment === ".") return result
    if (segment === "..") return result.slice(0, -1)
    return [...result, segment]
  }, [])
  return (replaced.startsWith("/") ? "/" : "") + segments.join("/")
}

function sameDir(a: string, b: string): boolean {
  return normalizeWorktreeDir(a) === normalizeWorktreeDir(b)
}

/**
 * The auto-named branch for a thread's worktree: `grist/<slug>-<shortid>`.
 * The slug comes from the thread title when there is one; the short id
 * (last 6 alphanumerics of the thread/draft id) keeps names unique even
 * for untitled threads. Always a valid git ref component sequence.
 */
export function threadBranchName(input: { title?: string; id: string }): string {
  const slug = (input.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "")
  const short = input.id.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase() || "thread"
  return slug ? `grist/${slug}-${short}` : `grist/${short}`
}

/** Inventory entries the engine created (a strategy is recorded): the only removable ones. */
export function managedWorktrees(entries: readonly WorktreeInventoryEntry[]): WorktreeInventoryEntry[] {
  return entries.filter((entry) => entry.strategy !== undefined)
}

/** The managed worktree directory a thread runs in, if any. */
export function threadWorktree(
  thread: ThreadWorktreeRef,
  projects: readonly ProjectWorktrees[],
): { projectID: string; directory: string } | undefined {
  if (!thread.directory) return undefined
  for (const project of projects) {
    for (const entry of managedWorktrees(project.entries)) {
      if (sameDir(entry.directory, thread.directory)) return { projectID: project.projectID, directory: entry.directory }
    }
  }
  return undefined
}

/** True when `directory` is one of the given worktree directories (project sandboxes). */
export function isWorktreeDirectory(directory: string | undefined, worktreeDirs: readonly string[]): boolean {
  if (!directory) return false
  return worktreeDirs.some((candidate) => sameDir(candidate, directory))
}

export type WorktreeCleanupItem = {
  projectID: string
  directory: string
  reason: "archived" | "orphaned"
}

/**
 * Plan stale-worktree cleanup. A managed worktree is stale when every
 * thread that ran in it is archived. Orphaned managed worktrees (no
 * thread references them — e.g. their sessions were deleted) are stale
 * only with `includeOrphans`, for the racing-create reason above. The
 * project root is never in the managed set, so it can never be planned.
 */
export function planWorktreeCleanup(
  threads: readonly ThreadWorktreeRef[],
  projects: readonly ProjectWorktrees[],
  options?: { includeOrphans?: boolean },
): WorktreeCleanupItem[] {
  const plan: WorktreeCleanupItem[] = []
  for (const project of projects) {
    for (const entry of managedWorktrees(project.entries)) {
      const residents = threads.filter((thread) => thread.directory && sameDir(thread.directory, entry.directory))
      if (residents.length > 0) {
        if (residents.every((thread) => thread.archivedAt !== undefined))
          plan.push({ projectID: project.projectID, directory: entry.directory, reason: "archived" })
        continue
      }
      if (options?.includeOrphans) plan.push({ projectID: project.projectID, directory: entry.directory, reason: "orphaned" })
    }
  }
  return plan
}
