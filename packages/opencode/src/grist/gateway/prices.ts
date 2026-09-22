import { RUNG_MODELS, type Rung } from "../rung"

/**
 * Gateway metering prices (USD per 1M tokens), verified 2026-09-21.
 *
 * - DeepSeek V4.1 Flash is time-of-day priced: off-peak `$0.15/$0.60`, peak 2x
 *   (`$0.30/$1.20`). Peak windows are documented in `docs/providers.md`:
 *   UTC weekdays 01:00–04:00 and 06:00–10:00.
 * - Kimi K3 charges cached input tokens at `$0.30/M` instead of `$3/M`.
 * - Sol runs at the `$4/$20` promo through 2026-11-21, then `$5/$30`.
 */
export type TokenPrice = { input: number; output: number; cachedInput?: number }
export type ModelPrice = TokenPrice & { rung: Rung }

/**
 * Half-open `[startHour, endHour)` weekday peak windows in UTC. This is the
 * single source of truth for Flash peak billing; it matches `docs/providers.md`.
 */
export const PEAK_HOURS_UTC: ReadonlyArray<readonly [number, number]> = [
  [1, 4],
  [6, 10],
]
export const PEAK_MULTIPLIER = 2

/** Sol promo is active before this instant; standard pricing at/after it. */
export const SOL_PROMO_END_MS = Date.parse("2026-11-22T00:00:00Z")

const FLASH_OFFPEAK: TokenPrice = { input: 0.15, output: 0.6 }
const KIMI_PRICE: TokenPrice = { input: 3, output: 15, cachedInput: 0.3 }
const SOL_PROMO: TokenPrice = { input: 4, output: 20 }
const SOL_STANDARD: TokenPrice = { input: 5, output: 30 }

/** True during a DeepSeek weekday peak window (UTC). */
export function isPeakHourUTC(at: number): boolean {
  const date = new Date(at)
  const day = date.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = date.getUTCHours()
  return PEAK_HOURS_UTC.some(([start, end]) => hour >= start && hour < end)
}

const PUBLIC_IDS: Rung[] = ["cheapest", "medium", "frontier"]

export function ladderModelIDs(): string[] {
  return Object.values(RUNG_MODELS).map((m) => m.modelID)
}

/** Strip an `openrouter/` prefix so client and ladder ids compare equal. */
export function normalizeLadderModel(model: string): string {
  return model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model
}

/** Opaque id testers see (`cheapest` / `medium` / `frontier`). */
export function publicLadderID(model: string): Rung | undefined {
  const id = normalizeLadderModel(model)
  if (PUBLIC_IDS.includes(id as Rung)) return id as Rung
  for (const [rung, ref] of Object.entries(RUNG_MODELS) as [Rung, (typeof RUNG_MODELS)[Rung]][]) {
    if (ref.modelID === id) return rung
  }
}

/** Real OpenRouter id the gateway sends upstream. */
export function upstreamLadderID(model: string): string | undefined {
  const id = normalizeLadderModel(model)
  if (PUBLIC_IDS.includes(id as Rung)) return RUNG_MODELS[id as Rung].modelID
  for (const ref of Object.values(RUNG_MODELS)) {
    if (ref.modelID === id) return id
  }
}

/** Effective per-token price for a rung at a point in time. */
export function priceForRung(rung: Rung, at = Date.now()): ModelPrice {
  if (rung === "cheapest") {
    if (!isPeakHourUTC(at)) return { ...FLASH_OFFPEAK, rung }
    return {
      input: FLASH_OFFPEAK.input * PEAK_MULTIPLIER,
      output: FLASH_OFFPEAK.output * PEAK_MULTIPLIER,
      rung,
    }
  }
  if (rung === "medium") return { ...KIMI_PRICE, rung }
  return { ...(at < SOL_PROMO_END_MS ? SOL_PROMO : SOL_STANDARD), rung }
}

export function priceForModel(model: string, at = Date.now()): ModelPrice | undefined {
  const publicID = publicLadderID(model)
  if (!publicID) return
  return priceForRung(publicID, at)
}

/**
 * Bill input, cached input, and output tokens. `cachedInputTokens` is a subset
 * of `inputTokens`; when the model has no cached rate it bills at full input.
 */
export function usdForUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  options: { cachedInputTokens?: number; at?: number } = {},
): number {
  const price = priceForModel(model, options.at)
  if (!price) return 0
  const cached = Math.max(0, Math.min(options.cachedInputTokens ?? 0, inputTokens))
  const freshInput = inputTokens - cached
  const cachedRate = price.cachedInput ?? price.input
  return (freshInput * price.input + cached * cachedRate + outputTokens * price.output) / 1_000_000
}

export function isLadderModel(model: string): boolean {
  return publicLadderID(model) !== undefined
}