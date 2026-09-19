import { describe, expect, test } from "bun:test"
import { composeRung, shadowScores } from "./jev-gate"

describe("composeRung", () => {
  test("routes trivial low-sensitivity work to cheapest", () => {
    const { rung } = composeRung({ difficulty: 0.1, sensitivity: 0.1, underspecified: 0.1 })
    expect(rung).toBe("cheapest")
  })

  test("asks human when underspecified", () => {
    const { rung } = composeRung({ difficulty: 0.9, sensitivity: 0.1, underspecified: 0.9 })
    expect(rung).toBe("ask_human")
  })

  test("sensitivity caps frontier down to cheapest", () => {
    const { rung, reasons } = composeRung({ difficulty: 0.9, sensitivity: 0.9, underspecified: 0.1 })
    expect(rung).toBe("cheapest")
    expect(reasons.some((r) => r.includes("sensitivity"))).toBe(true)
  })

  test("medium difficulty without sensitivity cap", () => {
    const { rung } = composeRung({ difficulty: 0.5, sensitivity: 0.1, underspecified: 0.1 })
    expect(rung).toBe("medium")
  })
})

describe("shadowScores", () => {
  test("flags Fix it. as underspecified", () => {
    const s = shadowScores("Fix it.")
    expect(s.underspecified).toBeGreaterThan(0.7)
  })

  test("scoped rename stays easy", () => {
    const s = shadowScores("Rename unused helper in src/graph/map.ts and update call sites.")
    expect(s.difficulty).toBeLessThan(0.4)
    expect(s.underspecified).toBeLessThan(0.5)
  })

  test("production redesign is hard and sensitive", () => {
    const s = shadowScores(
      "We're seeing duplicate charges in payouts — redesign the ledger to be idempotent and migrate production.",
    )
    expect(s.difficulty).toBeGreaterThan(0.7)
    expect(s.sensitivity).toBeGreaterThan(0.4)
  })
})
