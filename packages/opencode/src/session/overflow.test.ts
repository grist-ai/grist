import { describe, expect, test } from "bun:test"
import { isOverflow, usable } from "./overflow"
import type { Provider } from "@/provider/provider"

const cfg = {} as any

function model(limit: { context: number; input?: number; output: number }) {
  return { limit } as Provider.Model
}

function tokens(total: number) {
  return { total, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } as any
}

describe("isOverflow", () => {
  test("never auto-compacts on a degenerate (<= 0) budget", () => {
    // context smaller than the reserved output budget -> usable() === 0.
    // Compacting here would fire on every step and wedge the agent loop.
    const degenerate = model({ context: 10_000, output: 32_000 })
    expect(usable({ cfg, model: degenerate })).toBe(0)
    expect(isOverflow({ cfg, tokens: tokens(999_999), model: degenerate })).toBe(false)
  })

  test("never auto-compacts when the input limit is degenerate", () => {
    const degenerate = model({ context: 200_000, input: 1_000, output: 32_000 })
    expect(usable({ cfg, model: degenerate })).toBe(0)
    expect(isOverflow({ cfg, tokens: tokens(999_999), model: degenerate })).toBe(false)
  })

  test("compacts normally on a sane budget", () => {
    const sane = model({ context: 200_000, output: 32_000 })
    const budget = usable({ cfg, model: sane })
    expect(budget).toBeGreaterThan(100_000)
    expect(isOverflow({ cfg, tokens: tokens(budget - 1), model: sane })).toBe(false)
    expect(isOverflow({ cfg, tokens: tokens(budget), model: sane })).toBe(true)
  })

  test("respects compaction.auto = false and context = 0", () => {
    const sane = model({ context: 200_000, output: 32_000 })
    expect(isOverflow({ cfg: { compaction: { auto: false } } as any, tokens: tokens(999_999), model: sane })).toBe(false)
    const zero = model({ context: 0, output: 32_000 })
    expect(isOverflow({ cfg, tokens: tokens(999_999), model: zero })).toBe(false)
  })
})
