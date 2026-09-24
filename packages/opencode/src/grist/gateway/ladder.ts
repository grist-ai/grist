/** Gateway-only ladder mapping: rung → upstream model.
 *
 * This module MUST stay gateway-only. Upstream model ids must never ship in
 * the client binary (extractable via `strings`). The client speaks rung names
 * only (`cheapest` / `medium` / `frontier`); the gateway resolves them here.
 */
import type { ModelRef, Rung } from "../rung"

/**
 * Ladder ids go through OpenRouter on the **gateway** (founder `OPENROUTER_API_KEY`).
 * Testers hold an invite code only — never a model key. Override any slot with
 * `GRIST_<RUNG>_PROVIDER` / `GRIST_<RUNG>_MODEL` on the gateway process.
 *
 * OpenRouter model ids keep their org/model slash (provider is still `openrouter`).
 */
export const DEFAULT_RUNG_MODELS: Record<Rung, ModelRef> = {
  cheapest: {
    providerID: "openrouter",
    // OpenRouter id for DeepSeek-V4.1-Flash (legacy deepseek-v4-flash still aliases).
    modelID: "deepseek/deepseek-v4.1-flash",
  },
  medium: {
    providerID: "openrouter",
    modelID: "moonshotai/kimi-k3",
  },
  frontier: {
    providerID: "openrouter",
    modelID: "openai/gpt-6-sol",
  },
}

/** Resolve a rung to the upstream model the gateway will call. */
export function resolveRung(rung: Rung, env: NodeJS.ProcessEnv = process.env): ModelRef {
  switch (rung) {
    case "cheapest":
      return {
        providerID: env.GRIST_CHEAPEST_PROVIDER ?? DEFAULT_RUNG_MODELS.cheapest.providerID,
        modelID: env.GRIST_CHEAPEST_MODEL ?? DEFAULT_RUNG_MODELS.cheapest.modelID,
      }
    case "medium":
      return {
        providerID: env.GRIST_MEDIUM_PROVIDER ?? DEFAULT_RUNG_MODELS.medium.providerID,
        modelID: env.GRIST_MEDIUM_MODEL ?? DEFAULT_RUNG_MODELS.medium.modelID,
      }
    case "frontier":
      return {
        providerID: env.GRIST_FRONTIER_PROVIDER ?? DEFAULT_RUNG_MODELS.frontier.providerID,
        modelID: env.GRIST_FRONTIER_MODEL ?? DEFAULT_RUNG_MODELS.frontier.modelID,
      }
    default: {
      const _exhaustive: never = rung
      return _exhaustive
    }
  }
}

/** Live ladder: env overrides win over `DEFAULT_RUNG_MODELS`. */
export const RUNG_MODELS: Record<Rung, ModelRef> = {
  get cheapest() {
    return resolveRung("cheapest")
  },
  get medium() {
    return resolveRung("medium")
  },
  get frontier() {
    return resolveRung("frontier")
  },
}
