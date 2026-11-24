import type { GatewayStore, TeamMemoryPolicyCounts, TeamObjectPolicyCounts } from "./store.js"

/**
 * Team filesystem policy job (spec v2 §§9–10, filesystem spec v1 §7 —
 * the hosted Dreaming loop).
 *
 * The gateway is a single Bun.serve process with no cron infrastructure,
 * so the sweep runs in-process on a timer: once shortly after boot, then
 * every GRIST_MEMORY_POLICY_INTERVAL_MS (default 6 hours). Set the
 * interval to `0` or `off` to disable the job entirely. The retention
 * window and decay factor the spec leaves open are env-tunable:
 * GRIST_MEMORY_RETENTION_DAYS (default 90) and
 * GRIST_MEMORY_DECAY_FACTOR (default 0.9, one step per window at most).
 *
 * One timer drives both streams, partitioned by kind (filesystem spec
 * v1 §7): memory keeps its evidence rules (merge, decay, staleness);
 * objects get archive-superseded + chain integrity only. The sweeps
 * themselves are mechanical and audit-logged — see `runTeamMemoryPolicy`
 * and `runTeamObjectPolicy` in store.ts. This module is only scheduling
 * and configuration; it holds no policy rules.
 */

export type TeamMemoryPolicyConfig = {
  intervalMs: number
  retentionMs: number
  decayFactor: number
  disabled: boolean
}

export const DEFAULT_POLICY_INTERVAL_MS = 6 * 3_600_000
const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_DECAY_FACTOR = 0.9
const BOOT_DELAY_MS = 30_000

export function teamMemoryPolicyConfig(
  env: Record<string, string | undefined> = process.env,
): TeamMemoryPolicyConfig {
  const rawInterval = env.GRIST_MEMORY_POLICY_INTERVAL_MS?.trim().toLowerCase()
  const disabled = rawInterval === "0" || rawInterval === "off"
  const parsedInterval = rawInterval ? Number(rawInterval) : Number.NaN
  const intervalMs =
    !disabled && Number.isFinite(parsedInterval) && parsedInterval > 0
      ? parsedInterval
      : DEFAULT_POLICY_INTERVAL_MS
  const days = Number(env.GRIST_MEMORY_RETENTION_DAYS)
  const retentionMs = (Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS) * 86_400_000
  const factor = Number(env.GRIST_MEMORY_DECAY_FACTOR)
  const decayFactor =
    Number.isFinite(factor) && factor > 0 && factor <= 1 ? factor : DEFAULT_DECAY_FACTOR
  return { intervalMs, retentionMs, decayFactor, disabled }
}

export type TeamMemorySweepResult = {
  teams: Array<{ teamId: string } & TeamMemoryPolicyCounts>
  totals: TeamMemoryPolicyCounts
}

export type TeamObjectSweepResult = {
  teams: Array<{ teamId: string } & TeamObjectPolicyCounts>
  totals: { archived: number; flagged: number }
}

/** Run one object sweep now (filesystem spec v1 §7 partition). */
export function runTeamObjectPolicySweep(
  store: GatewayStore,
  opts?: { now?: number },
): TeamObjectSweepResult {
  const teams = store.runTeamObjectPolicy({ now: opts?.now ?? Date.now() })
  const totals = { archived: 0, flagged: 0 }
  for (const team of teams) {
    totals.archived += team.archived
    totals.flagged += team.flagged
  }
  return { teams, totals }
}

/** Run one listener queue expiry pass now (next-block spec §6.1: queued
 * run requests carry a TTL; expiry is audited and notified, never
 * silent). Rides the same in-process timer as the memory/object sweeps. */
export function runListenerExpirySweep(
  store: GatewayStore,
  opts?: { now?: number },
): { expired: number } {
  const rows = store.expireListenerRunRequests({ now: opts?.now ?? Date.now() })
  return { expired: rows.length }
}

/** Run one sweep now. Unset knobs fall back to the env configuration. */
export function runTeamMemoryPolicySweep(
  store: GatewayStore,
  opts?: { now?: number; retentionMs?: number; decayFactor?: number },
): TeamMemorySweepResult {
  const config = teamMemoryPolicyConfig()
  const teams = store.runTeamMemoryPolicy({
    now: opts?.now ?? Date.now(),
    retentionMs: opts?.retentionMs ?? config.retentionMs,
    decayFactor: opts?.decayFactor ?? config.decayFactor,
  })
  const totals: TeamMemoryPolicyCounts = { merged: 0, flagged: 0, decayed: 0, archived: 0 }
  for (const team of teams) {
    totals.merged += team.merged
    totals.flagged += team.flagged
    totals.decayed += team.decayed
    totals.archived += team.archived
  }
  return { teams, totals }
}

/**
 * Start the in-process schedule. Returns undefined when the job is
 * disabled by configuration. Overlapping runs cannot interleave: a tick
 * that finds a sweep still running is skipped.
 */
export function startTeamMemoryPolicy(
  store: GatewayStore,
  config: TeamMemoryPolicyConfig = teamMemoryPolicyConfig(),
): { stop: () => void } | undefined {
  if (config.disabled) return undefined
  let running = false
  const run = () => {
    if (running) return
    running = true
    try {
      const { teams, totals } = runTeamMemoryPolicySweep(store, {
        retentionMs: config.retentionMs,
        decayFactor: config.decayFactor,
      })
      const objects = runTeamObjectPolicySweep(store)
      const listeners = runListenerExpirySweep(store)
      console.info(
        `[grist-gateway] team memory policy sweep: ${teams.length} team(s), ` +
          `merged ${totals.merged}, flagged ${totals.flagged}, ` +
          `decayed ${totals.decayed}, archived ${totals.archived}; ` +
          `objects archived ${objects.totals.archived}, objects flagged ${objects.totals.flagged}; ` +
          `listener requests expired ${listeners.expired}`,
      )
    } catch (error) {
      console.error("[grist-gateway] team memory policy sweep failed", error)
    } finally {
      running = false
    }
  }
  const boot = setTimeout(run, BOOT_DELAY_MS)
  const timer = setInterval(run, config.intervalMs)
  boot.unref()
  timer.unref()
  return {
    stop: () => {
      clearTimeout(boot)
      clearInterval(timer)
    },
  }
}
