/** Grist model ladder rungs (pre-POC: cheapest → medium → frontier). */
export type Rung = "cheapest" | "medium" | "frontier"

export type ModelRef = {
  providerID: string
  modelID: string
  variant?: string
}

/**
 * Ladder ids go through OpenRouter on the **gateway** (founder `OPENROUTER_API_KEY`).
 * Testers hold an invite code only — never a model key. Override any slot with
 * `GRIST_<RUNG>_PROVIDER` / `GRIST_<RUNG>_MODEL` on the gateway process.
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
    modelID: process.env.GRIST_MEDIUM_MODEL ?? "moonshotai/kimi-k3",
  },
  frontier: {
    providerID: process.env.GRIST_FRONTIER_PROVIDER ?? "openrouter",
    modelID: process.env.GRIST_FRONTIER_MODEL ?? "openai/gpt-6-sol",
  },
}

/** Tester-facing labels. Vendor ids stay on the gateway. */
export const PUBLIC_RUNG_NAME: Record<Rung, string> = {
  cheapest: "Fast",
  medium: "Standard",
  frontier: "Max",
}

export function publicModelRef(rung: Rung): ModelRef {
  return { providerID: "openrouter", modelID: rung }
}
