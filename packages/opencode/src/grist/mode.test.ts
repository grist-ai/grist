import { describe, expect, test } from "bun:test"
import { applyModeCap, loadOperatingMode, modeMaxRung } from "./mode"
import { composeRung } from "./jev-gate"
import { DEFAULT_THRESHOLDS } from "./thresholds"

describe("operating mode", () => {
  test("loadOperatingMode aliases", () => {
    expect(loadOperatingMode("normal")).toBe("normal")
    expect(loadOperatingMode("capped")).toBe("capped")
    expect(loadOperatingMode("cap")).toBe("capped")
    expect(loadOperatingMode("cheapest")).toBe("cheapest")
    expect(loadOperatingMode("cheapest-only")).toBe("cheapest")
    expect(loadOperatingMode(undefined)).toBe("normal")
  })

  test("modeMaxRung ceilings", () => {
    expect(modeMaxRung("normal")).toBe("premium")
    expect(modeMaxRung("capped")).toBe("medium")
    expect(modeMaxRung("cheapest")).toBe("cheapest")
  })

  test("applyModeCap degrades premium under capped", () => {
    const { rung, reasons } = applyModeCap("premium", "capped")
    expect(rung).toBe("medium")
    expect(reasons).toContain("mode_capped_cap")
  })

  test("applyModeCap degrades frontier under capped", () => {
    const { rung, reasons } = applyModeCap("frontier", "capped")
    expect(rung).toBe("medium")
    expect(reasons).toContain("mode_capped_cap")
  })

  test("composeRung respects capped mode", () => {
    const { rung, reasons, mode } = composeRung(
      { difficulty: 0.9, sensitivity: 0.1, underspecified: 0.1 },
      DEFAULT_THRESHOLDS,
      "capped",
    )
    expect(mode).toBe("capped")
    expect(rung).toBe("medium")
    expect(reasons).toContain("mode_capped_cap")
  })

  test("composeRung respects cheapest-only mode", () => {
    const { rung } = composeRung(
      { difficulty: 0.9, sensitivity: 0.1, underspecified: 0.1 },
      DEFAULT_THRESHOLDS,
      "cheapest",
    )
    expect(rung).toBe("cheapest")
  })
})
