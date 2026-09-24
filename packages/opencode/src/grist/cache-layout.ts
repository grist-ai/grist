/**
 * Eric Zakariasson §4 — cache layout: stable prefix, explicit breakpoints.
 *
 * Order each request so the reusable prefix is as long as possible:
 *   tools (sorted) → system instructions → [breakpoint] → setup → [breakpoint] → conversation
 *
 * Anthropic / OpenRouter-Claude honor inline `cache_control: { type: "ephemeral" }`
 * (default TTL 5 minutes; optional `ttl: "1h"`). Minimum cacheable prefix is
 * 1024 tokens (2048 on Haiku). Shorter prefixes are a no-op at the provider.
 *
 * OpenAI-compatible OpenRouter models (DeepSeek, Kimi, GPT-6) use automatic
 * prefix caching: keep the leading bytes identical and skip undocumented
 * `prompt_cache_key`. Session IDs stay in headers, not in the prompt prefix.
 *
 * Behind GRIST_CACHE_LAYOUT=1. Flag off keeps today's single joined system blob.
 */

import type { ModelMessage } from "ai"

export type LayoutInput = {
  identity: string[]
  doctrine: string
  setup: string[]
  nudges?: string
  userSystem?: string
}

export type Layout = {
  prefix: string
  setup: string
  messages: ModelMessage[]
}

/** Anthropic ephemeral cache: 5-minute TTL, no 1h upgrade (stay within default billing). */
export const EPHEMERAL = { type: "ephemeral" as const }

export const BREAKPOINT_OPTIONS = {
  anthropic: { cacheControl: EPHEMERAL },
  openrouter: { cacheControl: EPHEMERAL },
  bedrock: { cachePoint: { type: "default" as const } },
  openaiCompatible: { cache_control: EPHEMERAL },
  copilot: { copilot_cache_control: EPHEMERAL },
  alibaba: { cacheControl: EPHEMERAL },
}

/** Default 5-minute Anthropic TTL; 1024-token (2048 Haiku) minimum prefix. */
export const CACHE_RULES = {
  ttl: "5m ephemeral (Anthropic default; 1h available but not set)",
  minTokens: 1024,
  minTokensHaiku: 2048,
  maxBreakpoints: 4,
}

export function layoutEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.GRIST_CACHE_LAYOUT === "1"
}

export function split(input: LayoutInput): { prefix: string; setup: string } {
  const prefix = [...input.identity, input.doctrine].filter((part) => part.trim()).join("\n")
  const setup = [...input.setup, input.nudges, input.userSystem]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n")
  return { prefix, setup }
}

export function assemble(input: LayoutInput): Layout {
  const { prefix, setup } = split(input)
  const messages: ModelMessage[] = [{ role: "system", content: prefix }]
  if (setup) messages.push({ role: "system", content: setup })
  return { prefix, setup, messages }
}

/**
 * Mark the first system message (tools+identity prefix) and the last system
 * message (setup) with cache breakpoints. Conversation history is left alone —
 * earlier messages are not rewritten except by compaction.
 */
export function applyBreakpoints(messages: ModelMessage[]): ModelMessage[] {
  const systems = messages.filter((message) => message.role === "system")
  const first = systems[0]
  const last = systems[systems.length - 1]
  return messages.map((message) => {
    if (message.role !== "system") return message
    if (message !== first && message !== last) return message
    return withBreakpoint(message)
  })
}

export function withBreakpoint(message: ModelMessage): ModelMessage {
  if (message.role !== "system") return message
  return {
    role: "system",
    content: systemText(message),
    providerOptions: mergeOptions(message.providerOptions),
  }
}

function systemText(message: ModelMessage) {
  if (typeof message.content === "string") return message.content
  return message.content
    .flatMap((part) => ("text" in part && typeof part.text === "string" ? [part.text] : []))
    .join("\n")
}

export function supportsExplicitBreakpoints(model: {
  providerID: string
  id: string
  api: { id: string; npm: string }
}) {
  const haystack = `${model.providerID} ${model.id} ${model.api.id}`.toLowerCase()
  if (model.api.npm === "@ai-sdk/gateway") return false
  return (
    haystack.includes("anthropic") ||
    haystack.includes("claude") ||
    model.api.npm === "@ai-sdk/anthropic" ||
    model.api.npm === "@ai-sdk/google-vertex/anthropic" ||
    model.api.npm === "@ai-sdk/alibaba"
  )
}

export function sortTools<T>(tools: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b)))
}

export function prefixFingerprint(tools: string[], prefix: string) {
  return JSON.stringify({ tools: [...tools].toSorted((a, b) => a.localeCompare(b)), prefix })
}

export function cacheHitRate(cachedInput: number, input: number) {
  if (input <= 0) return 0
  return cachedInput / input
}

function mergeOptions(existing: unknown) {
  const base = existing && typeof existing === "object" ? existing : {}
  return { ...base, ...BREAKPOINT_OPTIONS }
}

export const CacheLayout = {
  layoutEnabled,
  split,
  assemble,
  applyBreakpoints,
  supportsExplicitBreakpoints,
  sortTools,
  prefixFingerprint,
  cacheHitRate,
  CACHE_RULES,
  BREAKPOINT_OPTIONS,
}
