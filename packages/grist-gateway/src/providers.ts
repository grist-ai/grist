/** BYOK provider abstraction for the Grist gateway.
 *
 * The gateway no longer assumes a single founder-held inference key. Each user
 * brings their own provider key (stored encrypted per user; see
 * `provider-keys.ts`), and this module resolves (provider, rung) → upstream
 * endpoint + model id so the request path stays provider-agnostic.
 *
 * Supported providers:
 * - `openrouter` — https://openrouter.ai (ladder ids verified in production)
 * - `vercel` — Vercel AI Gateway, https://ai-gateway.vercel.sh (0% markup)
 * - `custom` — any OpenAI-compatible base URL; the user supplies model ids
 */

import { JEV_ENDPOINTS, JEV_MODELS } from "@grist-ai/logic"
import { resolveRung } from "./ladder.js"
import type { Rung } from "@grist-ai/logic"

export type ByokProvider = "openrouter" | "vercel" | "custom"

export const BYOK_PROVIDERS: readonly ByokProvider[] = ["openrouter", "vercel", "custom"]

export function parseByokProvider(raw: unknown): ByokProvider | undefined {
  if (typeof raw !== "string") return undefined
  const id = raw.trim().toLowerCase()
  return (BYOK_PROVIDERS as readonly string[]).includes(id) ? (id as ByokProvider) : undefined
}

export interface ProviderEndpoints {
  chatCompletions: string
  /** Empty for `custom`: Jev is only served on OpenRouter / Vercel / direct. */
  jevEndpoint: string
  jevModel: string
}

/**
 * Fixed endpoints for the known providers. `custom` endpoints derive from the
 * user's stored base URL. Returns undefined for `custom` without a base URL.
 */
export function providerEndpoints(provider: ByokProvider, customBaseURL?: string): ProviderEndpoints | undefined {
  switch (provider) {
    case "openrouter":
      return {
        chatCompletions: "https://openrouter.ai/api/v1/chat/completions",
        jevEndpoint: JEV_ENDPOINTS.openrouter,
        jevModel: JEV_MODELS.openrouter,
      }
    case "vercel":
      return {
        chatCompletions: "https://ai-gateway.vercel.sh/v1/chat/completions",
        jevEndpoint: JEV_ENDPOINTS.vercel,
        jevModel: JEV_MODELS.vercel,
      }
    case "custom": {
      const base = customBaseURL?.trim().replace(/\/+$/, "")
      if (!base) return undefined
      return { chatCompletions: `${base}/chat/completions`, jevEndpoint: "", jevModel: "" }
    }
  }
}

/**
 * Rung → upstream model id for Vercel AI Gateway. PROVISIONAL — vendor
 * prefixes are not guaranteed to match OpenRouter's, so verify each id against
 * https://vercel.com/ai-gateway/models (or GET /v1/models) before sending
 * live traffic. Override any slot with GRIST_VERCEL_<RUNG>_MODEL.
 */
const VERCEL_LADDER_MODELS: Record<Rung, string> = {
  cheapest: "deepseek/deepseek-v4.1-flash",
  medium: "moonshotai/kimi-k3",
  frontier: "openai/gpt-6-sol",
  premium: "anthropic/claude-opus-5.5",
}

/**
 * Upstream model id for (provider, rung). Precedence: the account's rung
 * override wins, then env (`GRIST_<PROVIDER>_<RUNG>_MODEL`, e.g.
 * GRIST_VERCEL_FRONTIER_MODEL), then the compiled ladder table. `custom`
 * has no ladder table — the user supplies per-rung ids in their provider
 * config (`customModels`), which already act as the override.
 */
export function ladderModel(
  provider: ByokProvider,
  rung: Rung,
  env: NodeJS.ProcessEnv = process.env,
  rungModelOverrides?: Partial<Record<Rung, string>>,
): string | undefined {
  const accountOverride = rungModelOverrides?.[rung]?.trim()
  if (accountOverride) return accountOverride
  const override = env[`GRIST_${provider.toUpperCase()}_${rung.toUpperCase()}_MODEL`]?.trim()
  if (override) return override
  switch (provider) {
    case "openrouter":
      // resolveRung so GRIST_<RUNG>_MODEL overrides (Railway) keep working.
      return resolveRung(rung, env).modelID
    case "vercel":
      return VERCEL_LADDER_MODELS[rung]
    case "custom":
      return undefined
  }
}

export interface ResolvedUpstream {
  provider: ByokProvider
  chatCompletionsURL: string
  model: string
  jevEndpoint: string
  jevModel: string
}

/**
 * Resolve (provider, rung) → everything the request path needs to call
 * upstream. Returns undefined when the provider is `custom` without a base
 * URL, or when a `custom` provider has no model id stored for the rung.
 */
export function resolveUpstream(input: {
  provider: ByokProvider
  rung: Rung
  customBaseURL?: string
  customModels?: Partial<Record<Rung, string>>
  rungModelOverrides?: Partial<Record<Rung, string>>
  env?: NodeJS.ProcessEnv
}): ResolvedUpstream | undefined {
  const endpoints = providerEndpoints(input.provider, input.customBaseURL)
  if (!endpoints) return undefined
  const model =
    input.provider === "custom"
      ? input.customModels?.[input.rung]?.trim() || undefined
      : ladderModel(input.provider, input.rung, input.env, input.rungModelOverrides)
  if (!model) return undefined
  return {
    provider: input.provider,
    chatCompletionsURL: endpoints.chatCompletions,
    model,
    jevEndpoint: endpoints.jevEndpoint,
    jevModel: endpoints.jevModel,
  }
}
