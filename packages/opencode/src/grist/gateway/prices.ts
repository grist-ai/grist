import { RUNG_MODELS, type Rung } from "../rung"

/** USD per 1M tokens for gateway metering (first-party / typical OpenRouter, 2026-09-21). */
export const LADDER_PRICES: Record<string, { input: number; output: number; rung: Rung }> = {
  "deepseek/deepseek-v4.1-flash": { input: 0.15, output: 0.6, rung: "cheapest" },
  "moonshotai/kimi-k3": { input: 3, output: 15, rung: "medium" },
  "openai/gpt-5.6-sol": { input: 4, output: 20, rung: "frontier" },
}

export function ladderModelIDs(): string[] {
  return Object.values(RUNG_MODELS).map((m) => m.modelID)
}

/** Strip an `openrouter/` prefix so client and ladder ids compare equal. */
export function normalizeLadderModel(model: string): string {
  return model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model
}

export function priceForModel(model: string) {
  return LADDER_PRICES[normalizeLadderModel(model)]
}

export function usdForUsage(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceForModel(model)
  if (!price) return 0
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}

export function isLadderModel(model: string): boolean {
  const id = normalizeLadderModel(model)
  return id in LADDER_PRICES || ladderModelIDs().includes(id)
}
