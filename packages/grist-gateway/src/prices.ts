import { DEFAULT_RUNG_MODELS, resolveRung } from "./ladder.js"
import { MODEL_PRICES } from "./model-prices.js"
import type { ByokProvider } from "./providers.js"
import type { Rung } from "@grist-ai/logic"

/**
 * Gateway metering prices (USD per 1M tokens).
 *
 * The meter prices the resolved upstream model, not the rung label. Default
 * ladder models keep the verified-2026-09-22 rung rates so no-override
 * metering is unchanged; every other id uses the OpenRouter /api/v1/models
 * snapshot in `model-prices.ts` (2026-09-23). Unknown resolved models fall
 * back to the rung they occupy.
 *
 * - DeepSeek V4.1 Flash is time-of-day priced: off-peak `$0.15/$0.60`, peak 2x
 *   (`$0.30/$1.20`). Peak windows are documented in `docs/providers.md`:
 *   UTC weekdays 01:00–04:00 and 06:00–10:00.
 * - Kimi K3 charges cached input tokens at `$0.30/M` instead of `$3/M`.
 * - GPT-6 Sol (frontier, launched 2026-09-22) is permanently `$2/$10`.
 * - Claude Opus 5.5 (premium, launched 2026-09-22) is `$4/$20` with `$0.20/M`
 *   cache reads (verified on claude.com/pricing 2026-09-23).
 * - Claude Opus 5.5 (premium, launched 2026-09-22) is `$4/$20` with `$0.20/M`
 *   cache reads (verified on claude.com/pricing 2026-09-23).
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

const FLASH_MODEL_ID = DEFAULT_RUNG_MODELS.cheapest.modelID
const FLASH_OFFPEAK: TokenPrice = { input: 0.15, output: 0.6 }
const KIMI_PRICE: TokenPrice = { input: 3, output: 15, cachedInput: 0.3 }
const SOL_PRICE: TokenPrice = { input: 2, output: 10 }
const OPUS55_PRICE: TokenPrice = { input: 4, output: 20, cachedInput: 0.2 }

/** Existing rung rates for the default ladder model ids. */
const RUNG_MODEL_PRICES: Record<string, TokenPrice> = {
  [DEFAULT_RUNG_MODELS.cheapest.modelID]: FLASH_OFFPEAK,
  [DEFAULT_RUNG_MODELS.medium.modelID]: KIMI_PRICE,
  [DEFAULT_RUNG_MODELS.frontier.modelID]: SOL_PRICE,
  [DEFAULT_RUNG_MODELS.premium.modelID]: OPUS55_PRICE,
}

const PUBLIC_IDS: Rung[] = ["cheapest", "medium", "frontier", "premium"]

function isRung(id: string): id is Rung {
  return PUBLIC_IDS.includes(id as Rung)
}

/** True during a DeepSeek weekday peak window (UTC). */
export function isPeakHourUTC(at: number): boolean {
  const date = new Date(at)
  const day = date.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = date.getUTCHours()
  return PEAK_HOURS_UTC.some(([start, end]) => hour >= start && hour < end)
}

export function ladderModelIDs(env: NodeJS.ProcessEnv = process.env): string[] {
  return PUBLIC_IDS.map((rung) => resolveRung(rung, env).modelID)
}

/** Strip an `openrouter/` prefix so client and ladder ids compare equal. */
export function normalizeLadderModel(model: string): string {
  return model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model
}

/** Opaque id testers see (`cheapest` / `medium` / `frontier` / `premium`). */
export function publicLadderID(model: string, env: NodeJS.ProcessEnv = process.env): Rung | undefined {
  const id = normalizeLadderModel(model)
  if (isRung(id)) return id
  return PUBLIC_IDS.find((rung) => resolveRung(rung, env).modelID === id)
}

/** Real OpenRouter id the gateway sends upstream. */
export function upstreamLadderID(model: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const id = normalizeLadderModel(model)
  if (isRung(id)) return resolveRung(id, env).modelID
  if (PUBLIC_IDS.some((rung) => resolveRung(rung, env).modelID === id)) return id
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
  if (rung === "premium") return { ...OPUS55_PRICE, rung }
  return { ...SOL_PRICE, rung }
}

/** Vercel AI Gateway charges 0% markup; OpenRouter list prices carry ~5.5%. */
const VERCEL_PRICE_FACTOR = 1 / 1.055

function scalePrice(price: TokenPrice, factor: number): TokenPrice {
  return {
    input: price.input * factor,
    output: price.output * factor,
    cachedInput: price.cachedInput === undefined ? undefined : price.cachedInput * factor,
  }
}

function listedPrice(modelID: string, provider: ByokProvider): TokenPrice | undefined {
  // Custom endpoints bill at their own rates, which the gateway cannot see.
  if (provider === "custom") return undefined
  // Merge the rung override over the base model price so fields the override
  // doesn't set (notably cachedInput) survive. A wholesale replace silently
  // billed cached tokens at the full input rate (cheapest rung: $0.15/M
  // instead of $0.0042/M).
  const base = MODEL_PRICES[modelID]
  const override = RUNG_MODEL_PRICES[modelID]
  const price = override ? { ...base, ...override } : base
  if (!price) return undefined
  return provider === "vercel" ? scalePrice(price, VERCEL_PRICE_FACTOR) : price
}

function withTimeOfDay(modelID: string, price: TokenPrice, at: number): TokenPrice {
  if (modelID !== FLASH_MODEL_ID || !isPeakHourUTC(at)) return price
  return {
    input: price.input * PEAK_MULTIPLIER,
    output: price.output * PEAK_MULTIPLIER,
    cachedInput: price.cachedInput,
  }
}

/** Effective per-token price for a resolved upstream model (or rung name). */
export function priceForModel(
  model: string,
  at = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
  provider: ByokProvider = "openrouter",
): ModelPrice | undefined {
  // Custom endpoints bill at their own rates, which the gateway cannot see —
  // nothing here is a valid price for them, not even the rung fallback.
  if (provider === "custom") return undefined
  const id = normalizeLadderModel(model)
  const resolved = isRung(id) ? resolveRung(id, env).modelID : id
  const listed = listedPrice(resolved, provider)
  const rung = publicLadderID(id, env)
  if (listed) return { ...withTimeOfDay(resolved, listed, at), rung: rung ?? "cheapest" }
  if (!rung) return
  const fallback = priceForRung(rung, at)
  if (provider === "vercel") return { ...scalePrice(fallback, VERCEL_PRICE_FACTOR), rung }
  return fallback
}

/**
 * Bill input, cached input, and output tokens. `cachedInputTokens` is a subset
 * of `inputTokens`; when the model has no cached rate it bills at full input.
 * Custom providers price at zero — the gateway cannot see their rates.
 */
export function usdForUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  options: {
    cachedInputTokens?: number
    at?: number
    env?: NodeJS.ProcessEnv
    provider?: ByokProvider
  } = {},
): number {
  const price = priceForModel(model, options.at, options.env, options.provider ?? "openrouter")
  if (!price) return 0
  const cached = Math.max(0, Math.min(options.cachedInputTokens ?? 0, inputTokens))
  const freshInput = inputTokens - cached
  const cachedRate = price.cachedInput ?? price.input
  return (freshInput * price.input + cached * cachedRate + outputTokens * price.output) / 1_000_000
}

export function isLadderModel(model: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return publicLadderID(model, env) !== undefined
}
