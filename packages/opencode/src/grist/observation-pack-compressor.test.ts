import { describe, expect, test } from "bun:test"
import {
  clampBytes,
  collectSignals,
  costGate,
  digest,
  estimateTokens,
  isExplorationTask,
  loadLimits,
  runCompressed,
  shouldCompress,
} from "./observation-pack-compressor"

const byteLength = (s: string) => Buffer.byteLength(s, "utf-8")

describe("observation-pack-compressor", () => {
  test("clampBytes never splits a code point", () => {
    const text = "héllo wörld"
    const clamped = clampBytes(text, 4)
    expect(byteLength(clamped)).toBeLessThanOrEqual(4)
    expect(text.startsWith(clamped)).toBe(true)
    expect(clampBytes("abc", 10)).toBe("abc")
    expect(clampBytes("abc", 0)).toBe("")
  })

  test("estimateTokens approximates bytes/4", () => {
    expect(estimateTokens("12345678")).toBe(2)
    expect(estimateTokens("")).toBe(0)
  })

  test("loadLimits honors env overrides", () => {
    const limits = loadLimits({ GRIST_OBS_COMPRESS_BYTES: "128", GRIST_OBS_COMPRESS_STEPS: "3" } as NodeJS.ProcessEnv)
    expect(limits.digestBytes).toBe(128)
    expect(limits.maxSteps).toBe(3)
    expect(limits.maxTokens).toBe(50_000)
  })

  test("collectSignals pulls actionable lines, deduped", () => {
    const signals = collectSignals("ok\nError: boom\nwarning: dep\nError: boom\nplain")
    expect(signals).toEqual(["Error: boom", "warning: dep"])
  })

  test("isExplorationTask distinguishes explore from build", () => {
    expect(isExplorationTask("Explore why the worker hangs")).toBe(true)
    expect(isExplorationTask("run the unit tests")).toBe(false)
  })

  test("costGate only passes when savings clear overhead and floor", () => {
    expect(costGate({ traceBytes: 1_000, digestBytes: 4_096 }).pass).toBe(false)
    expect(costGate({ traceBytes: 8_000, digestBytes: 4_096 }).pass).toBe(true)
    expect(costGate({ traceBytes: 100, digestBytes: 4_096 }).reason).toBe("cost_exceeds_savings")
  })

  test("digest stays under the cap and keeps task + signals", () => {
    const trace = `${"Error: connection reset\n"}${"x".repeat(20_000)}\nFINAL: root cause in worker.ts`
    const out = digest({ task: "Explore the reconnect hang", text: trace, steps: 4, tokens: 100 })
    expect(byteLength(out)).toBeLessThanOrEqual(4_096)
    expect(out).toContain("[grist:observation-pack] exploration digest")
    expect(out).toContain("task: Explore the reconnect hang")
    expect(out).toContain("Error: connection reset")
    expect(out).toContain("budget: steps=4/16")
  })

  test("digest respects a custom small cap", () => {
    const out = digest({ task: "Explore", text: "y".repeat(5_000), limits: { digestBytes: 256 } })
    expect(byteLength(out)).toBeLessThanOrEqual(256)
  })

  test("shouldCompress routes exploration past the cost gate", () => {
    const decision = shouldCompress({ task: "Explore the bug", traceBytes: 20_000 })
    expect(decision.compress).toBe(true)
    if (decision.compress) expect(decision.savingsBytes).toBeGreaterThan(0)
  })

  test("shouldCompress skips non-exploration and small traces", () => {
    expect(shouldCompress({ task: "run the tests", traceBytes: 20_000 }).reason).toBe("not_exploration")
    expect(shouldCompress({ task: "Explore the bug", traceBytes: 500 }).reason).toBe("cost_exceeds_savings")
  })

  test("runCompressed returns a digest for a large exploration trace", async () => {
    const trace = {
      text: `Error: flaky\n${"z".repeat(20_000)}`,
      steps: 3,
      tokens: 120,
    }
    const result = await runCompressed({ task: "Explore the flaky test", run: () => trace })
    expect(result.compressed).toBe(true)
    expect(result.output).not.toBe(trace.text)
    expect(byteLength(result.output)).toBeLessThanOrEqual(4_096)
    expect(result.steps).toBe(3)
  })

  test("runCompressed passes small or non-exploration traces through", async () => {
    const small = await runCompressed({ task: "Explore tiny", run: () => ({ text: "ok", steps: 1, tokens: 1 }) })
    expect(small.compressed).toBe(false)
    expect(small.output).toBe("ok")

    const build = await runCompressed({
      task: "run the tests",
      run: () => ({ text: "q".repeat(20_000), steps: 2, tokens: 5_000 }),
    })
    expect(build.compressed).toBe(false)
  })

  test("runCompressed flags a budget overrun without throwing", async () => {
    const result = await runCompressed({
      task: "Explore the bug",
      limits: { maxSteps: 1, maxTokens: 10 },
      run: () => ({ text: `Error: x\n${"w".repeat(20_000)}`, steps: 9, tokens: 999 }),
    })
    expect(result.compressed).toBe(true)
    if (result.compressed) expect(result.budgetExceeded).toBe(true)
  })
})
