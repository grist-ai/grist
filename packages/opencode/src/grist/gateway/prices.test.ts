import { describe, expect, test } from "bun:test"
import { SOL_PROMO_END_MS, isPeakHourUTC, usdForUsage } from "./prices"

const MONDAY_NOON = Date.UTC(2026, 8, 21, 12, 0, 0)
const MONDAY_PEAK = Date.UTC(2026, 8, 21, 2, 0, 0)
const SATURDAY_PEAK = Date.UTC(2026, 8, 19, 2, 0, 0)

describe("DeepSeek Flash peak pricing", () => {
  test("flags weekday peak windows in UTC only", () => {
    expect(isPeakHourUTC(MONDAY_PEAK)).toBe(true)
    expect(isPeakHourUTC(MONDAY_NOON)).toBe(false)
    expect(isPeakHourUTC(SATURDAY_PEAK)).toBe(false)
  })

  test("bills off-peak at 0.15/0.60", () => {
    expect(usdForUsage("deepseek/deepseek-v4.1-flash", 1_000_000, 0, { at: MONDAY_NOON })).toBeCloseTo(0.15)
    expect(usdForUsage("cheapest", 0, 1_000_000, { at: MONDAY_NOON })).toBeCloseTo(0.6)
  })

  test("doubles the rate during peak", () => {
    expect(usdForUsage("deepseek/deepseek-v4.1-flash", 1_000_000, 0, { at: MONDAY_PEAK })).toBeCloseTo(0.3)
    expect(usdForUsage("openrouter/cheapest", 0, 1_000_000, { at: MONDAY_PEAK })).toBeCloseTo(1.2)
  })
})

describe("Kimi cached input pricing", () => {
  test("bills cached tokens at 0.30 instead of 3", () => {
    expect(usdForUsage("moonshotai/kimi-k3", 1_000_000, 0, { cachedInputTokens: 1_000_000 })).toBeCloseTo(0.3)
    expect(usdForUsage("medium", 1_000_000, 0, { cachedInputTokens: 500_000 })).toBeCloseTo(1.65)
    expect(usdForUsage("medium", 0, 1_000_000)).toBeCloseTo(15)
  })

  test("ignores cached counts beyond the input total", () => {
    expect(usdForUsage("medium", 1_000_000, 0, { cachedInputTokens: 9_000_000 })).toBeCloseTo(0.3)
  })
})

describe("Sol effective-date pricing", () => {
  test("uses the 4/20 promo through 2026-11-21", () => {
    expect(usdForUsage("openai/gpt-5.6-sol", 1_000_000, 0, { at: Date.parse("2026-11-21T12:00:00Z") })).toBeCloseTo(4)
    expect(usdForUsage("frontier", 0, 1_000_000, { at: Date.parse("2026-11-21T12:00:00Z") })).toBeCloseTo(20)
  })

  test("switches to 5/30 after 2026-11-21", () => {
    expect(usdForUsage("openai/gpt-5.6-sol", 1_000_000, 0, { at: SOL_PROMO_END_MS })).toBeCloseTo(5)
    expect(usdForUsage("openrouter/frontier", 0, 1_000_000, { at: SOL_PROMO_END_MS + 1 })).toBeCloseTo(30)
  })
})