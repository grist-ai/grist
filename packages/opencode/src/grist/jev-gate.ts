import { RUNG_MODELS, type ModelRef, type Rung } from "./rung"
import { loadThresholds, type GateThresholds } from "./thresholds"
import { createBurnInLog } from "./burn-in"

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
const JEV_MODEL = "jev-latest"

export type GateDecision = {
  rung: Rung
  model: ModelRef
  provider: "jev" | "shadow"
  difficulty: number
  sensitivity: number
  underspecified: number
  reasons: string[]
  latencyMs: number
}

export type GateInput = {
  text: string
  current: ModelRef
  /** When true, never rewrite model (explicit user/agent pin). */
  pinned?: boolean
  sessionID?: string
}

type ScoreAnswer = {
  type: "score"
  score: number
  confidence?: number
}

type NoulAnswer = {
  type: "noul"
  noul: number
}

type SystemOneResult = {
  model: string
  answers: Record<string, ScoreAnswer | NoulAnswer | { type: string }>
}

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** Normalize Score answers that may be 0–N levels into 0–1. */
function score01(answer: ScoreAnswer | undefined, levels: number): number {
  if (!answer || answer.type !== "score") return 0.5
  const max = Math.max(1, levels - 1)
  return clamp01(answer.score / max)
}

/**
 * Compose rung from difficulty + sensitivity + underspecified (pre-POC §4).
 * Underspecified tasks stay on cheapest (no ask-human rung).
 * Thresholds default until shadow burn-in calibrates them (§8.6).
 */
export function composeRung(
  input: {
    difficulty: number
    sensitivity: number
    underspecified: number
  },
  thresholds: GateThresholds = loadThresholds(),
): { rung: Rung; reasons: string[] } {
  const reasons: string[] = []

  // Sensitivity caps how high we may escalate.
  let max: Rung = "frontier"
  if (input.sensitivity >= thresholds.sensitivityCapCheapest) {
    max = "cheapest"
    reasons.push("sensitivity_cap_cheapest")
  } else if (input.sensitivity >= thresholds.sensitivityCapMedium) {
    max = "medium"
    reasons.push("sensitivity_cap_medium")
  }

  let want: Rung = "cheapest"
  if (input.underspecified >= thresholds.underspecifiedCheapest) {
    want = "cheapest"
    reasons.push("underspecified_cheapest")
  } else if (input.difficulty >= thresholds.difficultyFrontier) {
    want = "frontier"
    reasons.push("difficulty_frontier")
  } else if (input.difficulty >= thresholds.difficultyMedium) {
    want = "medium"
    reasons.push("difficulty_medium")
  } else {
    reasons.push("difficulty_cheapest")
  }

  const order = { cheapest: 0, medium: 1, frontier: 2 } as const
  const rung = order[want] <= order[max] ? want : max
  if (rung !== want) reasons.push(`capped_to_${rung}`)
  return { rung, reasons }
}

/** Heuristic shadow evaluator when TYPESAFE_API_KEY is absent. */
export function shadowScores(text: string): {
  difficulty: number
  sensitivity: number
  underspecified: number
} {
  const t = text.trim()
  const lower = t.toLowerCase()
  const words = t.split(/\s+/).filter(Boolean).length

  let underspecified = 0.1
  if (words < 4 || /^(fix|help|it|this|that)[.!]?$/i.test(t)) underspecified = 0.95
  else if (words < 8 && !/[./\\]/.test(t)) underspecified = 0.75

  let sensitivity = 0.1
  if (/(auth|secret|password|credential|pii|hipaa|gdpr|prod(uction)?\s+migrat)/i.test(lower)) {
    sensitivity = 0.85
  } else if (/(ledger|payment|billing|refund|deploy|infra)/i.test(lower)) {
    sensitivity = 0.55
  }

  let difficulty = 0.2
  if (/(redesign|architect|migrat|distributed|idempotent|rewrite)/i.test(lower)) difficulty = 0.85
  else if (/(refactor|multi-?file|across|race|concurren)/i.test(lower)) difficulty = 0.55
  else if (/(rename|typo|comment|lint|format|test for)/i.test(lower)) difficulty = 0.15

  return { difficulty, sensitivity, underspecified }
}

async function evaluateWithJev(text: string, apiKey: string): Promise<{
  difficulty: number
  sensitivity: number
  underspecified: number
}> {
  const body = {
    model: JEV_MODEL,
    state: {
      task: text,
      product: "Grist",
      ladder: "cheapest=DeepSeek Flash, medium=DeepSeek Pro, frontier=Claude Opus",
    },
    questions: {
      difficulty: {
        type: "score",
        instructions:
          "How hard is this coding task for a capable agent with repo tools?",
        criteria: [
          "Trivial scoped edit or question",
          "Routine change with clear files",
          "Multi-step but well-specified",
          "Hard: redesign, subtle correctness, or broad blast radius",
          "Frontier-grade: novel architecture or high-risk production change",
        ],
      },
      sensitivity: {
        type: "score",
        instructions:
          "How sensitive is the code/context (secrets, auth, proprietary, irreversible prod)?",
        criteria: [
          "Public or disposable",
          "Normal product code",
          "Business-sensitive logic",
          "Auth, secrets, or compliance-adjacent",
          "Must not leave cheapest tier without human review",
        ],
      },
      underspecified: {
        type: "noul",
        instructions:
          "Is the task vague (missing goal/files)? High yes should prefer the cheapest rung, not invent scope.",
        criteria: {
          true: "Missing goal, files, or success criteria",
          false: "Clear enough to attempt",
        },
      },
    },
  }

  const response = await fetch(JEV_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Jev HTTP ${response.status}`)
  }
  const result = (await response.json()) as SystemOneResult
  const difficulty = score01(result.answers.difficulty as ScoreAnswer, 5)
  const sensitivity = score01(result.answers.sensitivity as ScoreAnswer, 5)
  const underspecified =
    (result.answers.underspecified as NoulAnswer | undefined)?.type === "noul"
      ? clamp01((result.answers.underspecified as NoulAnswer).noul)
      : 0.1
  return { difficulty, sensitivity, underspecified }
}

function modelForRung(rung: Rung, _current: ModelRef): ModelRef {
  return { ...RUNG_MODELS[rung] }
}

/**
 * Route a user task onto the model ladder.
 * Passthrough when pinned or when GRIST_GATE=off.
 */
export async function routeTask(input: GateInput): Promise<GateDecision> {
  const started = Date.now()
  if (input.pinned || process.env.GRIST_GATE === "off") {
    return {
      rung: "cheapest",
      model: input.current,
      provider: "shadow",
      difficulty: 0,
      sensitivity: 0,
      underspecified: 0,
      reasons: ["passthrough"],
      latencyMs: Date.now() - started,
    }
  }

  const key = process.env.TYPESAFE_API_KEY?.trim()
  let scores: { difficulty: number; sensitivity: number; underspecified: number }
  let provider: "jev" | "shadow" = "shadow"
  if (key) {
    try {
      scores = await evaluateWithJev(input.text, key)
      provider = "jev"
    } catch (error) {
      console.warn("[grist] Jev call failed; using shadow gate", error)
      scores = shadowScores(input.text)
    }
  } else {
    scores = shadowScores(input.text)
  }

  const { rung, reasons } = composeRung(scores)
  const model = modelForRung(rung, input.current)
  const decision: GateDecision = {
    rung,
    model,
    provider,
    ...scores,
    reasons,
    latencyMs: Date.now() - started,
  }
  console.log(
    `[grist:gate] ${rung} via ${provider} · diff=${scores.difficulty.toFixed(2)} sens=${scores.sensitivity.toFixed(2)} under=${scores.underspecified.toFixed(2)} · ${reasons.join(",")} · ${decision.latencyMs}ms → ${model.providerID}/${model.modelID}`,
  )
  // Shadow burn-in: durable JSONL for calibration (§8.6). Never blocks the turn.
  void createBurnInLog()
    .recordDecision({
      decision,
      sessionID: input.sessionID,
      text: input.text,
    })
    .catch((error) => console.warn("[grist:burn-in] record failed", error))
  return decision
}

export function textFromParts(parts: ReadonlyArray<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("\n")
    .trim()
}
