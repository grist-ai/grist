import { orderThreads, type ThreadStatus, type ThreadSummary } from "./thread-model.js"

/**
 * D1 — the supervision sidebar view-model (pure, tested).
 *
 * The desktop home already lists sessions; what the Codex model adds is
 * supervision semantics: threads grouped by project, ordered for
 * attention (running first, then most recent), with badges for unread
 * results and pending requests (permission asks + question forms — the
 * approval surfaces the runtime already has). This module computes that
 * view from the client's `SessionInfo` shape so the app, the desktop,
 * and a future team dashboard all render the same model.
 */

export type SessionInfoLike = {
  id: string
  projectID: string
  title?: string
  cost?: number
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number; idle?: number; viewed?: number; archived?: number }
  location: { directory: string }
  parentID?: string
  fork?: { sessionID: string }
}

/** Client SessionInfo → ThreadSummary. Status: a recorded outcome wins;
 *  a session with no idle timestamp is treated as running. */
export function summaryFromSessionInfo(info: SessionInfoLike): ThreadSummary {
  const status: ThreadStatus = info.outcome ?? (info.time.idle ? "idle" : "running")
  return {
    id: info.id,
    title: info.title,
    projectID: info.projectID,
    directory: info.location.directory,
    parentID: info.parentID,
    forkedFrom: info.fork?.sessionID,
    status,
    viewed: info.time.viewed !== undefined,
    updatedAt: info.time.updated,
    viewedAt: info.time.viewed,
    archivedAt: info.time.archived,
    totalCost: info.cost ?? 0,
    stepCount: 0,
    itemCount: 0,
  }
}

export type ThreadBadge = {
  status: ThreadStatus
  /** Finished (or changed) since the user last viewed the thread. */
  unread: boolean
  /** Pending permission/question requests awaiting the user. */
  pendingRequests: number
  needsAttention: boolean
}

export function threadBadge(summary: ThreadSummary, pendingRequests: number): ThreadBadge {
  const unread =
    summary.updatedAt !== undefined && (summary.viewedAt === undefined || summary.updatedAt > summary.viewedAt)
  return {
    status: summary.status,
    unread,
    pendingRequests,
    needsAttention: pendingRequests > 0,
  }
}

export type ProjectGroup = {
  projectID: string
  /** Directory basename — the human label for a project. */
  label: string
  directory?: string
  threads: ThreadSummary[]
  /** Total pending requests across the group's threads. */
  pendingRequests: number
  /** Threads with unread results. */
  unreadCount: number
  /** Most recent thread activity in the group (sidebar group order). */
  latestActivity: number
}

export function groupThreadsByProject(
  threads: ThreadSummary[],
  pendingBySession: ReadonlyMap<string, number> = new Map(),
  options: { includeArchived?: boolean } = {},
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()
  for (const summary of threads) {
    if (summary.archivedAt !== undefined && !options.includeArchived) continue
    const projectID = summary.projectID ?? "unknown"
    let group = groups.get(projectID)
    if (!group) {
      group = {
        projectID,
        label: labelFor(summary),
        directory: summary.directory,
        threads: [],
        pendingRequests: 0,
        unreadCount: 0,
        latestActivity: 0,
      }
      groups.set(projectID, group)
    }
    group.threads.push(summary)
    group.pendingRequests += pendingBySession.get(summary.id) ?? 0
    if (threadBadge(summary, 0).unread) group.unreadCount += 1
    group.latestActivity = Math.max(group.latestActivity, summary.updatedAt ?? 0)
  }
  for (const group of groups.values()) {
    group.threads = orderThreads(group.threads.map((summary) => ({ summary, lastSeq: summary.updatedAt ?? 0 }))).map(
      (entry) => entry.summary,
    )
  }
  return [...groups.values()].sort((a, b) => b.latestActivity - a.latestActivity)
}

function labelFor(summary: ThreadSummary): string {
  const directory = summary.directory
  if (!directory) return summary.projectID ?? "Project"
  const parts = directory.split("/").filter((part) => part.length > 0)
  return parts[parts.length - 1] ?? directory
}
