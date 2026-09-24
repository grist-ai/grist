/**
 * Provider-aware Jev (System One) routing.
 *
 * OpenRouter: POST https://openrouter.ai/api/v1/systemone  model typesafe/jev-latest
 *   https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request
 *
 * Vercel AI Gateway TypeSafe-compatible (keeps noul / System One shape):
 *   POST https://ai-gateway.vercel.sh/typesafe/v1/systemone  model typesafe-ai/jev
 *   https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe
 *   (The evaluate API at /v1/evaluate uses `boolean` instead of `noul` — do not use it.)
 *
 * Direct TypeSafe: POST https://api.typesafe.ai/v1/systemone  model jev-latest
 *
 * Key lookup is `resolveProviderKey`. Swap that implementation for BYOK later;
 * this module must not log or persist keys.
 */

export type JevProvider = "openrouter" | "vercel" | "typesafe"

export type JevRoute = {
  provider: JevProvider
  endpoint: string
  model: string
  apiKey: string
}

/** Replace this for the per-user BYOK store. Must not log the return value. */
export type ProviderKeyResolver = (provider: JevProvider) => string | undefined

export const JEV_ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/v1/systemone",
  vercel: "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
  typesafe: "https://api.typesafe.ai/v1/systemone",
} as const

export const JEV_MODELS = {
  openrouter: "typesafe/jev-latest",
  vercel: "typesafe-ai/jev",
  typesafe: "jev-latest",
} as const

export function resolveProviderKey(provider: JevProvider, env: NodeJS.ProcessEnv = process.env): string | undefined {
  switch (provider) {
    case "openrouter":
      return trimKey(env.OPENROUTER_API_KEY)
    case "vercel":
      return trimKey(env.AI_GATEWAY_API_KEY)
    case "typesafe":
      return trimKey(env.TYPESAFE_API_KEY)
    default: {
      const _exhaustive: never = provider
      void _exhaustive
      return
    }
  }
}

/**
 * When `provider` is omitted: the user's inference provider (OpenRouter, then
 * Vercel, if a key is present) then direct TypeSafe. Explicit `provider` never
 * falls through.
 */
export function resolveJevRoute(input: {
  provider?: string
  env?: NodeJS.ProcessEnv
  resolveKey?: ProviderKeyResolver
} = {}): JevRoute | undefined {
  const env = input.env ?? process.env
  const resolveKey = input.resolveKey ?? ((provider: JevProvider) => resolveProviderKey(provider, env))
  const requested = parseProvider(input.provider)
  if (requested) return routeFor(requested, resolveKey)
  for (const provider of inferenceProviders(env)) {
    const route = routeFor(provider, resolveKey)
    if (route) return route
  }
  return routeFor("typesafe", resolveKey)
}

function inferenceProviders(env: NodeJS.ProcessEnv): JevProvider[] {
  const pinned = parseProvider(env.GRIST_JEV_PROVIDER)
  if (pinned && pinned !== "typesafe") return [pinned]
  return ["openrouter", "vercel"]
}

function parseProvider(raw: string | undefined): JevProvider | undefined {
  if (!raw) return
  const id = raw.trim().toLowerCase()
  if (id === "openrouter") return "openrouter"
  if (id === "vercel" || id === "ai-gateway") return "vercel"
  if (id === "typesafe") return "typesafe"
}

function routeFor(provider: JevProvider, resolveKey: ProviderKeyResolver): JevRoute | undefined {
  const apiKey = resolveKey(provider)
  if (!apiKey) return
  return {
    provider,
    endpoint: JEV_ENDPOINTS[provider],
    model: JEV_MODELS[provider],
    apiKey,
  }
}

function trimKey(value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return
  return trimmed
}

export const JevRoute = {
  resolveProviderKey,
  resolveJevRoute,
  JEV_ENDPOINTS,
  JEV_MODELS,
}
