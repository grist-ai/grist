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

/** The only rung ids the client may see or send. */
export const PUBLIC_RUNGS: readonly Rung[] = ["cheapest", "medium", "frontier"]

/** Strip an `openrouter/` prefix so client and rung ids compare equal. */
export function normalizePublicModel(model: string): string {
  return model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model
}

/**
 * Client-safe rung lookup. Deliberately imports nothing from
 * `gateway/ladder.ts`: upstream vendor model ids must never ship in the client
 * binary (B1), so this recognizes public rung names only and returns
 * `undefined` for anything else.
 */
export function publicRungFor(model: string): Rung | undefined {
  const id = normalizePublicModel(model)
  return PUBLIC_RUNGS.includes(id as Rung) ? (id as Rung) : undefined
}

/**
 * Public model reference for a rung: the client addresses the gateway with the
 * rung name as the model id; the gateway resolves it to the upstream model via
 * the gateway-only `RUNG_MODELS` (`src/grist/gateway/ladder.ts`).
 */
export function publicModelRef(rung: Rung): ModelRef {
  return { providerID: "openrouter", modelID: rung }
}
