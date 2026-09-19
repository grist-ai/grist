/** Grist model ladder rungs (pre-POC: cheapest → medium → frontier). */
export type Rung = "cheapest" | "medium" | "frontier"

export type ModelRef = {
  providerID: string
  modelID: string
  variant?: string
}

/**
 * Default ladder goes through OpenRouter so one `OPENROUTER_API_KEY` covers
 * every rung. Override any slot with `GRIST_<RUNG>_PROVIDER` / `GRIST_<RUNG>_MODEL`
 * (e.g. pin frontier to native Anthropic while keeping cheap/medium on OpenRouter).
 *
 * OpenRouter model ids keep their org/model slash (provider is still `openrouter`).
 */
export const RUNG_MODELS: Record<Rung, ModelRef> = {
  cheapest: {
    providerID: process.env.GRIST_CHEAPEST_PROVIDER ?? "openrouter",
    // OpenRouter id for DeepSeek-V4.1-Flash (legacy deepseek-v4-flash still aliases).
    modelID: process.env.GRIST_CHEAPEST_MODEL ?? "deepseek/deepseek-v4.1-flash",
  },
  medium: {
    providerID: process.env.GRIST_MEDIUM_PROVIDER ?? "openrouter",
    modelID: process.env.GRIST_MEDIUM_MODEL ?? "deepseek/deepseek-v4-pro",
  },
  frontier: {
    providerID: process.env.GRIST_FRONTIER_PROVIDER ?? "openrouter",
    modelID: process.env.GRIST_FRONTIER_MODEL ?? "anthropic/claude-opus-4.6",
  },
}
