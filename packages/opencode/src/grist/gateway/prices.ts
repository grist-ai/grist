import { RUNG_MODELS, type Rung } from "../rung"

/** USD per 1M tokens for gateway metering (first-party / typical OpenRouter, 2026-09-21). */
export const LADDER_PRICES: Record<string, { input: number; output: number; rung: Rung }> = {
  "deepseek/deepseek-v4.1-flash": { input: 0.15, output: 0.6, rung: "cheapest" },
  "moonshotai/kimi-k3": { input: 3, output: 15, rung: "medium" },
  "openai/gpt-5.6-sol": { input: 4, output: 20, rung: "frontier" },
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
  const priced = LADDER_PRICES[id]
  if (priced) return priced.rung
  for (const [rung, ref] of Object.entries(RUNG_MODELS) as [Rung, (typeof RUNG_MODELS)[Rung]][]) {
    if (ref.modelID === id) return rung
  }
}

/** Real OpenRouter id the gateway sends upstream. */
export function upstreamLadderID(model: string): string | undefined {
  const id = normalizeLadderModel(model)
  if (PUBLIC_IDS.includes(id as Rung)) return RUNG_MODELS[id as Rung].modelID
  if (id in LADDER_PRICES) return id
  for (const ref of Object.values(RUNG_MODELS)) {
    if (ref.modelID === id) return id
  }
}

export function priceForModel(model: string) {
  const publicID = publicLadderID(model)
  if (!publicID) return
  const upstream = upstreamLadderID(model)
  if (upstream && LADDER_PRICES[upstream]) return LADDER_PRICES[upstream]
  return Object.values(LADDER_PRICES).find((price) => price.rung === publicID)
}

export function usdForUsage(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceForModel(model)
  if (!price) return 0
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}

export function isLadderModel(model: string): boolean {
  return publicLadderID(model) !== undefined
}
