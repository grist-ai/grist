import type { TeamSyncStatus } from "@grist-ai/logic"

/**
 * Pure rendering of `grist team-memory status` — the per-repo sync state
 * (opt-in, mirror size, queued pushes, cursor, last sync). Never includes
 * entry bodies or any credential.
 */
export function formatTeamMemoryStatus(status: TeamSyncStatus, cwd: string): string {
  if (!status.enabled) {
    return [
      `Team memory sync: off for ${cwd}`,
      "  Opt in with: grist team-memory enable",
      "  Only verified learnings captured in this repo will sync to your team.",
    ].join("\n")
  }
  const lines = [
    `Team memory sync: on for ${cwd}`,
    `  Mirror: ${status.mirrorCount} team ${status.mirrorCount === 1 ? "entry" : "entries"} (cursor ${status.cursor})`,
    `  Queued to push: ${status.pendingCount} · pushed: ${status.pushedCount} · rejected: ${status.rejectedCount}`,
  ]
  if (status.lastPushAt) lines.push(`  Last push: ${new Date(status.lastPushAt).toISOString()}`)
  if (status.lastPullAt) lines.push(`  Last pull: ${new Date(status.lastPullAt).toISOString()}`)
  if (status.revoked) {
    lines.push("  Paused: the gateway reports no team for this account — rejoin a team, then run: grist team-memory enable")
  }
  if (status.lastError) lines.push(`  Last sync error: ${status.lastError}`)
  lines.push(`  State: ${status.path}`)
  return lines.join("\n")
}

export function teamMemoryStatusJson(status: TeamSyncStatus, cwd: string) {
  return {
    enabled: status.enabled,
    revoked: status.revoked,
    directory: cwd,
    mirror_entries: status.mirrorCount,
    pending_pushes: status.pendingCount,
    pushed: status.pushedCount,
    rejected: status.rejectedCount,
    cursor: status.cursor,
    ...(status.lastPushAt ? { last_push_at: new Date(status.lastPushAt).toISOString() } : {}),
    ...(status.lastPullAt ? { last_pull_at: new Date(status.lastPullAt).toISOString() } : {}),
    ...(status.lastError ? { last_error: status.lastError } : {}),
    state_path: status.path,
  }
}
