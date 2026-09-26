/** Grist model ladder rungs (cheapest → medium → frontier → premium). */

export type Rung = "cheapest" | "medium" | "frontier" | "premium"

export type ModelRef = {
  providerID: string
  modelID: string
  variant?: string
}

/** The v2 provider id carrying the ladder. Replaces v1's openrouter hijack. */
export const GRIST_PROVIDER_ID = "grist"

/** Tester-facing labels. Vendor ids stay on the gateway. */
export const PUBLIC_RUNG_NAME: Record<Rung, string> = {
  cheapest: "Fast",
  medium: "Standard",
  frontier: "Max",
  premium: "Ultra",
}

/** The only rung ids the client may see or send. */
export const PUBLIC_RUNGS: readonly Rung[] = ["cheapest", "medium", "frontier", "premium"]

/**
 * Client-safe rung lookup. Recognizes public rung names only and returns
 * `undefined` for anything else — upstream vendor model ids must never ship
 * in the client.
 */
export function publicRungFor(model: string): Rung | undefined {
  return PUBLIC_RUNGS.includes(model as Rung) ? (model as Rung) : undefined
}

/**
 * Public model reference for a rung: the client addresses the gateway with the
 * rung name as the model id; the gateway resolves it to the upstream model via
 * the gateway-only `RUNG_MODELS`. Vendor ids stay server-side.
 */
export function publicModelRef(rung: Rung): ModelRef {
  return { providerID: GRIST_PROVIDER_ID, modelID: rung }
}

/**
 * Conservative context-window floor per rung, in tokens. Client-safe by
 * design: plain numbers only, no upstream model identities. The gateway
 * resolves a rung to its upstream model server-side, so the client never
 * knows the real limit; these floors sit safely below every ladder model's
 * real context window.
 *
 * Why this exists: a rung's session model record must never inherit a tiny
 * (or zero) context limit — the compaction budget would collapse,
 * auto-compaction would fire on nearly every step, and a headless run would
 * loop until killed. Pinning the floors here keeps that budget sane.
 */
export const RUNG_CONTEXT_FLOOR: Record<Rung, number> = {
  cheapest: 131072,
  medium: 131072,
  frontier: 131072,
  premium: 131072,
}
