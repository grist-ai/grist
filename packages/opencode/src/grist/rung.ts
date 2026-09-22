/** Grist model ladder rungs (pre-POC: cheapest → medium → frontier). */
export type Rung = "cheapest" | "medium" | "frontier"

export type ModelRef = {
  providerID: string
  modelID: string
  variant?: string
}

/** Tester-facing labels. Vendor ids stay on the gateway. */
export const PUBLIC_RUNG_NAME: Record<Rung, string> = {
  cheapest: "Fast",
  medium: "Standard",
  frontier: "Max",
}

/**
 * Public model reference for a rung: the client addresses the gateway with the
 * rung name as the model id; the gateway resolves it to the upstream model via
 * the gateway-only `RUNG_MODELS` (`src/grist/gateway/ladder.ts`).
 */
export function publicModelRef(rung: Rung): ModelRef {
  return { providerID: "openrouter", modelID: rung }
}
