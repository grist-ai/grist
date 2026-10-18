import { describe, expect, test } from "bun:test"
import type { BurnInEvent } from "./burn-in.js"
import { calibrationEnvFile, suggestCalibration } from "./calibration.js"
import type { Rung } from "./rung.js"

let at = 0
function session(rung: Rung, outcomeValue: "success" | "fail", escalateTo?: Rung) {
  const sessionID = `s${at}`
  const events: BurnInEvent[] = [
    {
      id: `d${at}`, at: at++, kind: "decision", sessionID,
      decision: { rung, provider: "jev", difficulty: 0.3, sensitivity: 0, underspecified: 0, reasons: ["t"], latencyMs: 1, model: { providerID: "grist", modelID: rung } },
    } as BurnInEvent,
  ]
  if (escalateTo) {
    events.push({
      id: `d${at}`, at: at++, kind: "decision", sessionID,
      decision: { rung: escalateTo, provider: "jev", difficulty: 0.3, sensitivity: 0, underspecified: 0, reasons: ["esc"], latencyMs: 1, model: { providerID: "grist", modelID: escalateTo } },
    } as BurnInEvent)
  }
  events.push({ id: `o${at}`, at: at++, kind: "outcome", sessionID, outcome: outcomeValue } as BurnInEvent)
  return events
}

describe("suggestCalibration", () => {
  test("insufficient evidence → no suggestions", () => {
    const result = suggestCalibration(session("cheapest", "success"))
    expect(result.suggestions).toHaveLength(0)
    expect(result.verdict).toContain("Insufficient evidence")
  })

  test("under-routing at cheapest suggests lowering difficultyMedium", () => {
    const events: BurnInEvent[] = []
    // 10 cheapest starts: 4 succeed outright, 6 escalate → 5 rescued, 1 fails after escalation... plus direct fails
    for (let i = 0; i < 4; i++) events.push(...session("cheapest", "success"))
    for (let i = 0; i < 5; i++) events.push(...session("cheapest", "success", "medium"))
    events.push(...session("cheapest", "fail", "medium"))
    for (let i = 0; i < 5; i++) events.push(...session("medium", "success"))
    const result = suggestCalibration(events)
    const s = result.suggestions.find((x) => x.knob === "difficultyMedium")
    expect(s).toBeDefined()
    expect(s!.to).toBeLessThan(s!.from)
    expect(s!.env).toBe("GRIST_TH_DIFF_MEDIUM")
    expect(calibrationEnvFile(result)).toContain("GRIST_TH_DIFF_MEDIUM=")
  })

  test("healthy cheapest band suggests widening it", () => {
    const events: BurnInEvent[] = []
    for (let i = 0; i < 16; i++) events.push(...session("cheapest", "success"))
    const result = suggestCalibration(events)
    const s = result.suggestions.find((x) => x.knob === "difficultyMedium")
    expect(s).toBeDefined()
    expect(s!.to).toBeGreaterThan(s!.from)
  })
})
