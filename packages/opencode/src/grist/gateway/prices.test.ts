import { describe, expect, test } from "bun:test"
import { isPeakHourUTC, usdForUsage } from "./prices"

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

describe("GPT-6 Sol permanent pricing", () => {
  test("bills the frontier rung at a flat 2/10", () => {
    expect(usdForUsage("openai/gpt-6-sol", 1_000_000, 0)).toBeCloseTo(2)
    expect(usdForUsage("frontier", 0, 1_000_000)).toBeCloseTo(10)
    expect(usdForUsage("openrouter/frontier", 1_000_000, 1_000_000)).toBeCloseTo(12)
  })

  test("holds the 2/10 rate across the old promo boundary", () => {
    expect(usdForUsage("openai/gpt-6-sol", 1_000_000, 0, { at: Date.parse("2026-11-21T12:00:00Z") })).toBeCloseTo(2)
    expect(usdForUsage("openai/gpt-6-sol", 0, 1_000_000, { at: Date.parse("2026-11-22T00:00:00Z") })).toBeCloseTo(10)
  })
})