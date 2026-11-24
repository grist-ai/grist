import type { TeamObjectStatus } from "@grist-ai/logic"

/**
 * Pure rendering of `grist team-objects status` — the per-repo object
 * journal (opt-in, materialized mirror manifest, queued publishes,
 * objects cursor). Never includes object bodies or any credential.
 */
export function formatTeamObjectsStatus(status: TeamObjectStatus, cwd: string): string {
  if (!status.enabled) {
    return [
      `Team object sync: off for ${cwd}`,
      "  Objects ride the team sync opt-in — enable with: grist team-memory enable",
    ].join("\n")
  }
  const lines = [
    `Team object sync: on for ${cwd}`,
    `  Materialized: ${status.materialized.length} team ${status.materialized.length === 1 ? "object" : "objects"} (cursor ${status.cursor})`,
    ...status.materialized.map(
      (entry) => `    ${entry.kind} ${entry.name} — ${entry.path} (by ${entry.authorUserId})`,
    ),
    `  Queued to push: ${status.pendingCount} · pushed: ${status.pushedCount} · rejected: ${status.rejectedCount}`,
  ]
  if (status.lastPushAt) lines.push(`  Last push: ${new Date(status.lastPushAt).toISOString()}`)
  if (status.lastPullAt) lines.push(`  Last pull: ${new Date(status.lastPullAt).toISOString()}`)
  if (status.revoked) {
    lines.push("  Paused: the gateway reports no team for this account — rejoin a team, then run: grist team-memory enable")
  }
  if (status.lastError) lines.push(`  Last sync error: ${status.lastError}`)
  lines.push(`  Files: ${status.teamRoot} · ${status.globalRoot}`)
  return lines.join("\n")
}

export function teamObjectsStatusJson(status: TeamObjectStatus, cwd: string) {
  return {
    enabled: status.enabled,
    revoked: status.revoked,
    directory: cwd,
    cursor: status.cursor,
    materialized: status.materialized.map((entry) => ({
      kind: entry.kind,
      container: entry.container,
      name: entry.name,
      id: entry.id,
      path: entry.path,
      author_user_id: entry.authorUserId,
    })),
    pending_pushes: status.pendingCount,
    pushed: status.pushedCount,
    rejected: status.rejectedCount,
    ...(status.lastPushAt ? { last_push_at: new Date(status.lastPushAt).toISOString() } : {}),
    ...(status.lastPullAt ? { last_pull_at: new Date(status.lastPullAt).toISOString() } : {}),
    ...(status.lastError ? { last_error: status.lastError } : {}),
    team_root: status.teamRoot,
    global_root: status.globalRoot,
  }
}
