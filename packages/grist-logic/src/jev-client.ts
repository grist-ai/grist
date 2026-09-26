/** Shared TypeSafe System One (Jev) HTTP client for Grist control-plane judgments. */

import { JEV_ENDPOINTS, JEV_MODELS } from "./jev-route.js"

export const JEV_ENDPOINT = JEV_ENDPOINTS.typesafe
export const JEV_MODEL = JEV_MODELS.typesafe

export type ScoreAnswer = {
  type: "score"
  score: number
  confidence?: number
}

export type NoulAnswer = {
  type: "noul"
  noul: number
}

export type ChoiceAnswer = {
  type: "choice"
  choice: string
  confidence?: number
}

export type SystemOneAnswer = ScoreAnswer | NoulAnswer | ChoiceAnswer | { type: string }

export type SystemOneResult = {
  model: string
  answers: Record<string, SystemOneAnswer>
}

export type QuestionSpec =
  | {
      type: "score"
      instructions: string
      criteria: string[]
    }
  | {
      type: "noul"
      instructions: string
      criteria: { true: string; false: string }
    }
  | {
      type: "choice"
      instructions: string
      criteria: string[] | Record<string, string>
    }

export function clamp01(n: number) {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** Normalize Score answers that may be 0–N levels into 0–1. */
export function score01(answer: ScoreAnswer | undefined, levels: number): number {
  if (!answer || answer.type !== "score") return 0.5
  const max = Math.max(1, levels - 1)
  return clamp01(answer.score / max)
}

export function noul01(answer: NoulAnswer | undefined): number {
  if (!answer || answer.type !== "noul") return 0.5
  return clamp01(answer.noul)
}

export function typesafeKey(env: NodeJS.ProcessEnv = process.env) {
  return env.TYPESAFE_API_KEY?.trim() || undefined
}

export function controlPlaneEnabled(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.GRIST_CTRL?.trim().toLowerCase()
  if (raw === "off" || raw === "0" || raw === "false") return false
  return true
}

export async function askSystemOne(input: {
  state: Record<string, unknown>
  questions: Record<string, QuestionSpec>
  apiKey: string
  endpoint?: string
  model?: string
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}): Promise<SystemOneResult> {
  const endpoint = input.endpoint ?? JEV_ENDPOINT
  const model = input.model ?? JEV_MODEL
  const fetchImpl = input.fetch ?? globalThis.fetch
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      state: input.state,
      questions: input.questions,
    }),
  })
  if (!response.ok) throw new Error(`Jev HTTP ${response.status}`)
  const data = await response.json()
  if (!data || typeof data !== "object" || !("answers" in data)) throw new Error("Jev response missing answers")
  return data as SystemOneResult
}
