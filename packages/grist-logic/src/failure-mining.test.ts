import { describe, expect, test } from "bun:test"
import type { BurnInEvent } from "./burn-in.js"
import { distillFailures, errorSignature, failureClusters, groupFailures, misrouteTable } from "./failure-mining.js"
import type { Rung } from "./rung.js"

const err = (tool: string, error: string) => ({
  type: "tool",
  tool,
  state: { status: "error", error },
})
const ok = (tool: string) => ({ type: "tool", tool, state: { status: "completed", output: "done" } })

describe("errorSignature", () => {
  test("normalizes numbers, hex, case, whitespace", () => {
    expect(errorSignature("Error 12345 at 0xDEADBEEF\nstack...")).toBe("error # at #")
    expect(errorSignature("  Cannot   find module ")).toBe("cannot find module")
  })
})

describe("distillFailures", () => {
  test("recovered sessions need a repeated signature", () => {
    const parts = [err("shell", "command not found: foo"), ok("shell")]
    expect(distillFailures({ parts, container: "repo", recovered: true })).toHaveLength(0)
    const repeated = [err("shell", "command not found: foo"), err("shell", "command not found: foo"), ok("shell")]
    const out = distillFailures({ parts: repeated, container: "repo", recovered: true })
    expect(out).toHaveLength(1)
    expect(out[0]?.outcome).toBe("check_failed")
    expect(out[0]?.content).toContain("failed 2×")
    expect(out[0]?.metadata?.kind).toBe("negative_example")
  })

  test("failed sessions distill a single terminal failure", () => {
    const parts = [err("edit", "oldString not found in file")]
    const out = distillFailures({ parts, container: "repo", recovered: false })
    expect(out).toHaveLength(1)
    expect(out[0]?.content).toContain("known trap")
  })

  test("groupFailures counts by tool + signature", () => {
    const groups = groupFailures([err("shell", "boom 1234"), err("shell", "boom 9876"), err("read", "nope")])
    expect(groups[0]).toMatchObject({ tool: "shell", count: 2 })
    expect(groups).toHaveLength(2)
  })
})

function decision(at: number, sessionID: string, rung: Rung, reasons: string[] = ["task"]) {
  return {
    id: `d${at}`,
    at,
    kind: "decision",
    sessionID,
    decision: {
      rung,
      provider: "grist",
      difficulty: 0.2,
      sensitivity: 0,
      underspecified: 0,
      reasons,
      latencyMs: 1,
      model: { providerID: "grist", modelID: rung },
    },
  } as BurnInEvent
}
function outcome(at: number, sessionID: string, value: "success" | "fail") {
  return { id: `o${at}`, at, kind: "outcome", sessionID, outcome: value } as BurnInEvent
}

describe("misrouteTable", () => {
  test("joins decisions to outcomes and computes rescue rate", () => {
    const events: BurnInEvent[] = [
      decision(1, "s1", "cheapest"),
      outcome(2, "s1", "success"),
      decision(3, "s2", "cheapest"),
      decision(4, "s2", "medium"), // escalated
      outcome(5, "s2", "success"), // rescued
      decision(6, "s3", "cheapest"),
      decision(7, "s3", "frontier"),
      outcome(8, "s3", "fail"), // escalation failed
      decision(9, "s4", "premium"),
      outcome(10, "s4", "success"),
    ]
    const table = misrouteTable(events)
    const cheapest = table.find((r) => r.rung === "cheapest")!
    expect(cheapest.runs).toBe(3)
    expect(cheapest.successes).toBe(2)
    expect(cheapest.failures).toBe(1)
    expect(cheapest.escalatedRuns).toBe(2)
    expect(cheapest.rescued).toBe(1)
    expect(cheapest.escalationFailed).toBe(1)
    expect(cheapest.rescueRate).toBe(0.5)
    const premium = table.find((r) => r.rung === "premium")!
    expect(premium.successRate).toBe(1)
  })

  test("failureClusters groups by rung/mode/reason", () => {
    const events: BurnInEvent[] = [
      decision(1, "s1", "cheapest", ["deep_debug"]),
      outcome(2, "s1", "fail"),
      decision(3, "s2", "cheapest", ["deep_debug"]),
      outcome(4, "s2", "fail"),
    ]
    const clusters = failureClusters(events)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.count).toBe(2)
    expect(clusters[0]?.key).toContain("deep_debug")
  })
})
