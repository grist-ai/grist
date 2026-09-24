import { describe, expect, test } from "bun:test"
import { auditSession, declarePlan, recordTouch, resetAll } from "../diff-audit"
import { runGateBattery, suggestThresholds } from "./battery"
import type { BurnInSummary } from "../burn-in"

describe("diff-audit", () => {
  test("flags off-plan files", () => {
    resetAll()
    declarePlan("s1", ["src/a.ts"])
    recordTouch({ sessionID: "s1", filePath: "src/a.ts", tool: "edit" })
    recordTouch({ sessionID: "s1", filePath: "src/b.ts", tool: "write" })
    const audit = auditSession("s1")
    expect(audit.ok).toBe(false)
    expect(audit.offPlan).toContain("src/b.ts")
  })

  test("ok when no plan declared", () => {
    resetAll()
    recordTouch({ sessionID: "s2", filePath: "anywhere.ts", tool: "edit" })
    expect(auditSession("s2").ok).toBe(true)
  })
})

describe("gate battery", () => {
  test("shadow battery matches expects", () => {
    const { results, pass, total, ok } = runGateBattery()
    expect(total).toBe(5)
    expect(ok).toBe(true)
    expect(pass).toBe(5)
    expect(results.find((r) => r.id === "underspecified")?.ok).toBe(true)
  })

  test("suggestThresholds raises frontier bar when share high", () => {
    const summary: BurnInSummary = {
      decisions: 20,
      byRung: { cheapest: 10, medium: 5, frontier: 5, premium: 0 },
      tierMix: { cheapest: 0.5, medium: 0.25, frontier: 0.25, premium: 0 },
      outcomes: 0,
      successRate: 0,
      cheapestSuccessShare: 0,
      escalationPrecision: null,
      frontierShare: 0.25,
      premiumShare: 0,
    }
    const s = suggestThresholds(summary)
    expect(s.difficultyFrontier).toBeGreaterThan(0.75)
    expect(s.notes.some((n) => n.includes("frontier"))).toBe(true)
  })
})
