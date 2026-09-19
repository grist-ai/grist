import type { Rung } from "./rung"

/**
 * Operating modes (pre-POC §10).
 *
 * - `normal` — full ladder up to plan frontier budget
 * - `capped` — frontier off; medium is the top rung (~90% spend drop)
 * - `cheapest` — cheapest-only (lowest plan)
 *
 * Mode never hard-stops the agent — it degrades, never blocks.
 */
export type OperatingMode = "normal" | "capped" | "cheapest"

const ORDER: Record<Rung, number> = { cheapest: 0, medium: 1, frontier: 2 }

export function loadOperatingMode(raw = process.env.GRIST_MODE): OperatingMode {
  const value = raw?.trim().toLowerCase()
  if (value === "capped" || value === "cap") return "capped"
  if (value === "cheapest" || value === "cheap" || value === "cheapest-only") return "cheapest"
  return "normal"
}

/** Highest rung allowed under the active operating mode. */
export function modeMaxRung(mode: OperatingMode = loadOperatingMode()): Rung {
  if (mode === "cheapest") return "cheapest"
  if (mode === "capped") return "medium"
  return "frontier"
}

/**
 * Clamp a composed rung to the mode ceiling. Returns the rung plus any
 * reason tokens appended when the mode actually bites.
 */
export function applyModeCap(
  rung: Rung,
  mode: OperatingMode = loadOperatingMode(),
): { rung: Rung; reasons: string[] } {
  const max = modeMaxRung(mode)
  if (ORDER[rung] <= ORDER[max]) return { rung, reasons: [] }
  return { rung: max, reasons: [`mode_${mode}_cap`] }
}
