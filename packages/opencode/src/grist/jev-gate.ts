import { publicModelRef, type ModelRef, type Rung } from "./rung"
import { loadThresholds, type GateThresholds } from "./thresholds"
import { createBurnInLog } from "./burn-in"
import { applyModeCap, loadOperatingMode, type OperatingMode } from "./mode"
import {
  composeMechanisms,
  loadMechanismProfile,
  rememberSessionMechanisms,
  type MechanismSet,
} from "./mechanisms"
import { recordGristEvent } from "./usage-log"
import { rememberSessionControl } from "./control-plane"
import { gristLog, gristWarn } from "./debug"
import {
  askSystemOne,
  JEV_ENDPOINT,
  JEV_MODEL,
  noul01,
  score01,
  type NoulAnswer,
  type ScoreAnswer,
} from "./jev-client"
import { resolveJevRoute, type JevRoute } from "./jev-route"
import { loadInviteConfig } from "./invite/config"
import { fetchGateRoute, GatewayHttpError } from "./invite/client"

export type GateDecision = {
  rung: Rung
  model: ModelRef
  provider: "jev" | "shadow"
  mode: OperatingMode
  mechanisms: MechanismSet
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
  mode: OperatingMode = loadOperatingMode(),
): { rung: Rung; reasons: string[]; mode: OperatingMode } {
  const reasons: string[] = []

  // Sensitivity caps how high we may escalate.
  let max: Rung = "premium"
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
  } else if (input.difficulty >= thresholds.difficultyPremium) {
    want = "premium"
    reasons.push("difficulty_premium")
  } else if (input.difficulty >= thresholds.difficultyFrontier) {
    want = "frontier"
    reasons.push("difficulty_frontier")
  } else if (input.difficulty >= thresholds.difficultyMedium) {
    want = "medium"
    reasons.push("difficulty_medium")
  } else {
    reasons.push("difficulty_cheapest")
  }

  const order = { cheapest: 0, medium: 1, frontier: 2, premium: 3 } as const
  const sensitivityCapped = order[want] <= order[max] ? want : max
  if (sensitivityCapped !== want) reasons.push(`capped_to_${sensitivityCapped}`)

  // Operating mode (§10) — degrades, never hard-stops.
  const modeCap = applyModeCap(sensitivityCapped, mode)
  reasons.push(...modeCap.reasons)
  return { rung: modeCap.rung, reasons, mode }
}

/**
 * Reduce a prompt to its task essence so verbosity cannot inflate difficulty.
 * First paragraph, capped at ~500 chars; a long well-specified prompt is an
 * easy task, not a hard one.
 */
export function normalizeTaskText(text: string): string {
  const trimmed = text.trim()
  const firstParagraph = trimmed.split(/\n\s*\n/)[0] ?? trimmed
  return firstParagraph.slice(0, 500)
}

/** Heuristic shadow evaluator when no Jev provider key is present. */
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

export async function scoreTask(
  text: string,
  auth?: string | JevRoute,
  options?: { fetch?: (input: string, init?: RequestInit) => Promise<Response> },
): Promise<{
  scores: { difficulty: number; sensitivity: number; underspecified: number }
  provider: "jev" | "shadow"
}> {
  const essence = normalizeTaskText(text)
  const route = resolveScoreAuth(auth)
  if (!route) return { scores: shadowScores(essence), provider: "shadow" }
  try {
    return { scores: await evaluateWithJev(essence, route, options?.fetch), provider: "jev" }
  } catch (error) {
    gristWarn("[grist] Jev call failed; using shadow gate", error)
    return { scores: shadowScores(essence), provider: "shadow" }
  }
}

function resolveScoreAuth(auth?: string | JevRoute): JevRoute | undefined {
  if (typeof auth === "object") return auth
  if (typeof auth === "string") {
    if (!auth) return
    return {
      provider: "typesafe",
      endpoint: JEV_ENDPOINT,
      model: JEV_MODEL,
      apiKey: auth,
    }
  }
  return resolveJevRoute()
}

async function evaluateWithJev(
  text: string,
  route: JevRoute,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<{
  difficulty: number
  sensitivity: number
  underspecified: number
}> {
  const result = await askSystemOne({
    apiKey: route.apiKey,
    endpoint: route.endpoint,
    model: route.model,
    fetch: fetchImpl,
    state: {
      task: text,
      product: "Grist",
      ladder: "cheapest, medium, frontier, premium",
    },
    questions: {
      difficulty: {
        type: "score",
        instructions:
          "How hard is this coding task for a capable agent with repo tools? Judge the task's inherent difficulty only, never the prompt's length or level of detail. A long, well-specified prompt is an easy task, not a hard one.",
        criteria: [
          "Trivial scoped edit or question",
          "Routine change with clear files",
          "Multi-step but well-specified",
          "Hard: redesign, subtle correctness, or broad blast radius",
          "Premium-grade: the hardest problems, worth the top-tier model — novel architecture, extreme correctness demands, or bet-the-company production change",
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
  })
  return {
    difficulty: score01(result.answers.difficulty as ScoreAnswer, 5),
    sensitivity: score01(result.answers.sensitivity as ScoreAnswer, 5),
    underspecified: noul01(result.answers.underspecified as NoulAnswer | undefined),
  }
}

function modelForRung(rung: Rung, _current: ModelRef): ModelRef {
  return publicModelRef(rung)
}

/**
 * Route a user task onto the model ladder.
 * Passthrough when pinned or when GRIST_GATE=off.
 */
export async function routeTask(input: GateInput): Promise<GateDecision> {
  const started = Date.now()
  const mode = loadOperatingMode()
  const mechanisms = composeMechanisms(input.text, loadMechanismProfile())
  if (input.sessionID) rememberSessionMechanisms(input.sessionID, mechanisms)

  if (input.pinned || process.env.GRIST_GATE === "off") {
    if (input.sessionID) {
      const scores = shadowScores(input.text)
      rememberSessionControl(input.sessionID, {
        rung: "cheapest",
        difficulty: scores.difficulty,
        sensitivity: scores.sensitivity,
        underspecified: scores.underspecified,
        task: input.text,
      })
    }
    return {
      rung: "cheapest",
      model: input.current,
      provider: "shadow",
      mode,
      mechanisms,
      difficulty: 0,
      sensitivity: 0,
      underspecified: 0,
      reasons: ["passthrough"],
      latencyMs: Date.now() - started,
    }
  }

  const invite = loadInviteConfig()
  if (invite) {
    try {
      return await routeViaGateway(input, started, mode, mechanisms)
    } catch (error) {
      if (error instanceof GatewayHttpError && error.status === 402) throw error
      gristWarn("[grist] gateway gate failed; using local shadow", error)
    }
  }

  const { scores, provider } = await scoreTask(input.text)

  const { rung, reasons } = composeRung(scores, loadThresholds(), mode)
  const model = modelForRung(rung, input.current)
  const decision: GateDecision = {
    rung,
    model,
    provider,
    mode,
    mechanisms,
    ...scores,
    reasons,
    latencyMs: Date.now() - started,
  }
  if (input.sessionID) {
    rememberSessionControl(input.sessionID, {
      rung,
      difficulty: scores.difficulty,
      sensitivity: scores.sensitivity,
      underspecified: scores.underspecified,
      task: input.text,
    })
  }
  gristLog(
    `[grist:gate] ${rung} via ${provider} mode=${mode} · diff=${scores.difficulty.toFixed(2)} sens=${scores.sensitivity.toFixed(2)} under=${scores.underspecified.toFixed(2)} · ${reasons.join(",")} · ${decision.latencyMs}ms`,
  )
  gristLog(
    `[grist:mech] ${mechanisms.resolved} pack=${mechanisms.observationPack} compress=${mechanisms.observationPackCompressor} fusion=${mechanisms.actionFusion} · ${mechanisms.reasons.join(",")}`,
  )
  if (reasons.some((r) => r.startsWith("mode_"))) {
    recordGristEvent("grist-mode-cap", {
      sessionID: input.sessionID,
      mode,
      rung,
      reasons: reasons.filter((r) => r.startsWith("mode_")),
    })
  }
  // Shadow burn-in: durable JSONL for calibration (§8.6). Never blocks the turn.
  void createBurnInLog()
    .recordDecision({
      decision,
      sessionID: input.sessionID,
      text: input.text,
    })
    .catch((error) => gristWarn("[grist:burn-in] record failed", error))
  return decision
}

async function routeViaGateway(
  input: GateInput,
  started: number,
  mode: OperatingMode,
  fallback: MechanismSet,
): Promise<GateDecision> {
  const remote = await fetchGateRoute({ text: input.text, sessionID: input.sessionID })
  const mechanisms: MechanismSet = {
    profile: fallback.profile,
    resolved: remote.mechanisms.observation_pack ? "efficiency" : "performance",
    observationPack: remote.mechanisms.observation_pack,
    observationPackCompressor: remote.mechanisms.observation_pack_compressor ?? false,
    actionFusion: remote.mechanisms.action_fusion,
    reasons: ["gateway"],
  }
  if (input.sessionID) rememberSessionMechanisms(input.sessionID, mechanisms)
  const model: ModelRef = {
    providerID: remote.model.provider_id,
    modelID: remote.model.model_id,
  }
  const decision: GateDecision = {
    rung: remote.rung,
    model,
    provider: remote.provider ?? "jev",
    mode: remote.mode ?? mode,
    mechanisms,
    difficulty: remote.difficulty,
    sensitivity: remote.sensitivity,
    underspecified: remote.underspecified,
    reasons: remote.reasons,
    latencyMs: Date.now() - started,
  }
  if (input.sessionID) {
    rememberSessionControl(input.sessionID, {
      rung: remote.rung,
      difficulty: remote.difficulty,
      sensitivity: remote.sensitivity,
      underspecified: remote.underspecified,
      task: input.text,
    })
  }
  gristLog(
    `[grist:gate] ${decision.rung} via gateway/${decision.provider} mode=${decision.mode} · ${decision.reasons.join(",")} · ${decision.latencyMs}ms`,
  )
  return decision
}

export function textFromParts(parts: ReadonlyArray<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("\n")
    .trim()
}
