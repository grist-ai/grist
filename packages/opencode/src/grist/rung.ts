/** Grist model ladder rungs (pre-POC spec §3–4). */
export type Rung = "cheapest" | "medium" | "frontier" | "ask_human"

export type ModelRef = {
  providerID: string
  modelID: string
  variant?: string
}

/** Default provider/model ids per rung — override via env when keys land. */
export const RUNG_MODELS: Record<Exclude<Rung, "ask_human">, ModelRef> = {
  cheapest: {
    providerID: process.env.GRIST_CHEAPEST_PROVIDER ?? "deepseek",
    modelID: process.env.GRIST_CHEAPEST_MODEL ?? "deepseek-flash",
  },
  medium: {
    providerID: process.env.GRIST_MEDIUM_PROVIDER ?? "deepseek",
    modelID: process.env.GRIST_MEDIUM_MODEL ?? "deepseek-v4-pro",
  },
  frontier: {
    providerID: process.env.GRIST_FRONTIER_PROVIDER ?? "anthropic",
    modelID: process.env.GRIST_FRONTIER_MODEL ?? "claude-opus-4-20250514",
  },
}
