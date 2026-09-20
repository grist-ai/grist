/**
 * Post-act diff audit (pre-POC §7 doctrine enforcement).
 * Tracks files touched per session; flags paths outside an optional declared plan.
 * Logged as `[grist:diff-audit]`; also forwarded to Langfuse when keyed.
 */

import { recordGristEvent } from "./usage-log"
import { gristLog } from "./debug"

export type DiffTouch = {
  filePath: string
  tool: string
  at: number
}

export type DiffAudit = {
  sessionID: string
  touches: DiffTouch[]
  planned: string[]
  offPlan: string[]
  ok: boolean
}

const sessions = new Map<
  string,
  {
    touches: DiffTouch[]
    planned: string[]
  }
>()

function normalize(p: string) {
  return p.replaceAll("\\", "/").replace(/^\.\//, "")
}

export function declarePlan(sessionID: string, files: string[]) {
  const state = sessions.get(sessionID) ?? { touches: [], planned: [] }
  state.planned = files.map(normalize).filter(Boolean)
  sessions.set(sessionID, state)
}

export function recordTouch(input: { sessionID: string; filePath: string; tool: string }) {
  if (process.env.GRIST_DIFF_AUDIT === "off") return
  const state = sessions.get(input.sessionID) ?? { touches: [], planned: [] }
  state.touches.push({
    filePath: normalize(input.filePath),
    tool: input.tool,
    at: Date.now(),
  })
  sessions.set(input.sessionID, state)
}

export function auditSession(sessionID: string): DiffAudit {
  const state = sessions.get(sessionID) ?? { touches: [], planned: [] }
  const touched = [...new Set(state.touches.map((t) => t.filePath))]
  const planned = state.planned
  const offPlan =
    planned.length === 0
      ? []
      : touched.filter((file) => !planned.some((p) => file === p || file.endsWith("/" + p) || file.endsWith(p)))

  const result: DiffAudit = {
    sessionID,
    touches: state.touches,
    planned,
    offPlan,
    ok: offPlan.length === 0,
  }

  if (state.touches.length > 0) {
    gristLog(
      `[grist:diff-audit] session=${sessionID} files=${touched.length} planned=${planned.length} offPlan=${offPlan.length}${
        offPlan.length ? ` · ${offPlan.slice(0, 5).join(",")}` : ""
      }`,
    )
    recordGristEvent("grist-diff-audit", {
      sessionID,
      fileCount: touched.length,
      plannedCount: planned.length,
      offPlanCount: offPlan.length,
      offPlan: offPlan.slice(0, 20),
      ok: result.ok,
    })
  }
  return result
}

export function clearSession(sessionID: string) {
  sessions.delete(sessionID)
}

/** Test helper */
export function resetAll() {
  sessions.clear()
}
