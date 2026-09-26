/** Grist model ladder rungs (cheapest → medium → frontier → premium). */
export type Rung = "cheapest" | "medium" | "frontier" | "premium"

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
  premium: "Ultra",
}

/** The only rung ids the client may see or send. */
export const PUBLIC_RUNGS: readonly Rung[] = ["cheapest", "medium", "frontier", "premium"]

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

/**
 * Conservative context-window floor per rung, in tokens. Client-safe by
 * design: plain numbers only, no upstream model identities (B1). The gateway
 * resolves a rung to its upstream model server-side, so the client never
 * knows the real limit; these floors sit safely below every ladder model's
 * real context window.
 *
 * Why this exists: when a rung is pinned via `-m`, the session's model record
 * is built from an arbitrary template model in the provider registry. If that
 * template carries a tiny (or zero) context limit, the compaction budget
 * collapses and auto-compaction fires on nearly every step; each spurious
 * compaction injects a synthetic continue-nudge whose reply can never satisfy
 * the headless loop's exit check, so the session runs away until killed.
 * Pinning the floors here keeps that budget sane.
 */
export const RUNG_CONTEXT_FLOOR: Record<Rung, number> = {
  cheapest: 131072,
  medium: 131072,
  frontier: 131072,
  premium: 131072,
}
