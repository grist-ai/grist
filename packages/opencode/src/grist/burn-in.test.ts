import { describe, expect, test } from "bun:test"
import { createBurnInLog, meetsTierMixTargets, summarize, type BurnInEvent } from "./burn-in"
import { composeRung } from "./jev-gate"
import { DEFAULT_THRESHOLDS, loadThresholds, loadThresholdsFromJson } from "./thresholds"

describe("thresholds", () => {
  test("loadThresholds reads env overrides", () => {
    const t = loadThresholds({
      GRIST_TH_DIFF_MEDIUM: "0.3",
      GRIST_TH_DIFF_FRONTIER: "0.9",
    } as NodeJS.ProcessEnv)
    expect(t.difficultyMedium).toBe(0.3)
    expect(t.difficultyFrontier).toBe(0.9)
    expect(t.underspecifiedCheapest).toBe(DEFAULT_THRESHOLDS.underspecifiedCheapest)
  })

  test("composeRung respects custom thresholds", () => {
    const tight = { ...DEFAULT_THRESHOLDS, difficultyMedium: 0.2, difficultyFrontier: 0.5 }
    expect(composeRung({ difficulty: 0.25, sensitivity: 0.1, underspecified: 0.1 }, tight).rung).toBe(
      "medium",
    )
    expect(composeRung({ difficulty: 0.6, sensitivity: 0.1, underspecified: 0.1 }, tight).rung).toBe(
      "frontier",
    )
  })

  test("loadThresholdsFromJson fills defaults", () => {
    const t = loadThresholdsFromJson({ difficultyMedium: 0.33 })
    expect(t.difficultyMedium).toBe(0.33)
    expect(t.difficultyFrontier).toBe(DEFAULT_THRESHOLDS.difficultyFrontier)
  })
})

describe("burn-in summarize", () => {
  test("computes tier mix and target check", () => {
    const events: BurnInEvent[] = [
      decision("cheapest"),
      decision("cheapest"),
      decision("cheapest"),
      decision("cheapest"),
      decision("medium"),
    ]
    const summary = summarize(events)
    expect(summary.decisions).toBe(5)
    expect(summary.tierMix.cheapest).toBe(0.8)
    expect(summary.frontierShare).toBe(0)
    expect(meetsTierMixTargets(summary).ok).toBe(true)
  })

  test("flags expensive share over 5%", () => {
    const events: BurnInEvent[] = [
      decision("cheapest"),
      decision("frontier"),
      decision("frontier"),
    ]
    const check = meetsTierMixTargets(summarize(events))
    expect(check.ok).toBe(false)
    expect(check.reasons.some((r) => r.startsWith("expensive_share"))).toBe(true)
  })

  test("premium counts toward the expensive share", () => {
    const events: BurnInEvent[] = [decision("cheapest"), decision("premium")]
    const summary = summarize(events)
    expect(summary.premiumShare).toBe(0.5)
    expect(meetsTierMixTargets(summary).ok).toBe(false)
  })

  test("file log round-trips decisions", async () => {
    const lines: string[] = []
    const log = createBurnInLog({
      filePath: "/tmp/grist-burnin-test.jsonl",
      mkdir: async () => {},
      appendFile: async (_p, line) => {
        lines.push(line)
      },
      readFile: async () => lines.join(""),
    })
    const id = await log.recordDecision({
      decision: {
        rung: "cheapest",
        provider: "shadow",
        difficulty: 0.2,
        sensitivity: 0.1,
        underspecified: 0.1,
        reasons: ["difficulty_cheapest"],
        latencyMs: 1,
        model: { providerID: "deepseek", modelID: "deepseek-flash" },
      },
      text: "Rename helper in foo.ts",
      sessionID: "s1",
    })
    expect(id).toBeTruthy()
    await log.recordOutcome({ decisionID: id, outcome: "success", sessionID: "s1" })
    const report = await log.report()
    expect(report.summary.decisions).toBe(1)
    expect(report.summary.outcomes).toBe(1)
    expect(report.summary.successRate).toBe(1)
  })
})

function decision(rung: "cheapest" | "medium" | "frontier" | "premium"): BurnInEvent {
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    kind: "decision",
    decision: {
      rung,
      provider: "shadow",
      difficulty: 0.2,
      sensitivity: 0.1,
      underspecified: 0.1,
      reasons: [],
      latencyMs: 1,
      model: { providerID: "x", modelID: "y" },
    },
  }
}
