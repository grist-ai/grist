/**
 * Warm-subagent resume registry — tracks completed subagent children per parent
 * session so the primary can re-dispatch a follow-up onto the same warm child
 * (passing its sessionID to the subagent tool) instead of briefing a fresh one.
 *
 * Pure logic, no live sessions. Entries are bound to a parent session and never
 * leak across sessions; clearWarmSession drops them at teardown.
 *
 * Kill switch: `GRIST_WARM_SUBAGENTS=0` (or "false"); also off with `GRIST_CTRL=off`.
 * Resume cap: `GRIST_WARM_SUBAGENT_MAX_RESUMES` (default 3).
 */
import { controlPlaneEnabled } from "./jev-client.js"

type WarmChild = {
  childSessionID: string
  resumes: number
}

/** parentSessionID → agent → most recent warm child. */
const registry = new Map<string, Map<string, WarmChild>>()

const DEFAULT_MAX_RESUMES = 3

function maxResumes(env: NodeJS.ProcessEnv = process.env) {
  const n = Number(env.GRIST_WARM_SUBAGENT_MAX_RESUMES)
  if (!Number.isNaN(n) && n > 0) return Math.floor(n)
  return DEFAULT_MAX_RESUMES
}

/** Default on when the control plane is on; "0"/"false" disables. */
export function warmSubagentsEnabled(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.GRIST_WARM_SUBAGENTS?.trim().toLowerCase()
  if (raw === "0" || raw === "false") return false
  return controlPlaneEnabled(env)
}

/**
 * Record a completed child (never a failed/interrupted one) as the warm session
 * for (parent, agent). A different child starts its own resume count.
 */
export function recordWarmChild(parentSessionID: string, agent: string, childSessionID: string) {
  const children = registry.get(parentSessionID) ?? new Map<string, WarmChild>()
  registry.set(parentSessionID, children)
  const prev = children.get(agent)
  children.set(agent, {
    childSessionID,
    resumes: prev?.childSessionID === childSessionID ? prev.resumes : 0,
  })
}

/** A subagent call arriving with sessionID set resumes that child warm; count it. */
export function noteResume(parentSessionID: string, agent: string, childSessionID: string) {
  const children = registry.get(parentSessionID) ?? new Map<string, WarmChild>()
  registry.set(parentSessionID, children)
  const prev = children.get(agent)
  children.set(agent, {
    childSessionID,
    resumes: prev?.childSessionID === childSessionID ? prev.resumes + 1 : 1,
  })
}

/** False once the child's resume count reaches the cap. */
export function shouldNudge(parentSessionID: string, agent: string, env: NodeJS.ProcessEnv = process.env) {
  const child = registry.get(parentSessionID)?.get(agent)
  if (!child) return true
  return child.resumes < maxResumes(env)
}

/** Session teardown — drops every warm child bound to the parent session. */
export function clearWarmSession(sessionID: string) {
  registry.delete(sessionID)
}
