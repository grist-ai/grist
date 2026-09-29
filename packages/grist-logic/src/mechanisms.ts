/**
 * SoL-Pi mechanism Choice (pre-POC §5).
 *
 * Per-task set of harness mechanisms, routable via the gate:
 * - ObservationPack — pack large tool outputs
 * - ObservationPack compressor — run exploration in a subagent, return a digest
 * - Action Fusion — prefer edit_verify over edit→bash
 *
 * Profiles mirror SoL-Pi [Efficiency] vs [Performance]:
 * - efficiency — all on (token cuts, incl. exploration compressor)
 * - performance — ObservationPack off (full fidelity); fusion still on
 * - auto — pick from task text (default); exploration uses the compressor
 * - off — all off
 */

import { askSystemOne, controlPlaneEnabled, type ChoiceAnswer } from "./jev-client.js"
import { resolveJevRoute } from "./jev-route.js"
import { gristWarn } from "./debug.js"

export type MechanismProfile = "auto" | "efficiency" | "performance" | "off"

/** Per-task effort inside a rung: how hard the agent should work, independent of cost tier. */
export type Effort = "low" | "standard" | "high"

export type MechanismSet = {
  profile: MechanismProfile
  resolved: "efficiency" | "performance" | "off"
  effort: Effort
  observationPack: boolean
  observationPackCompressor: boolean
  actionFusion: boolean
  reasons: string[]
}

const sessions = new Map<string, MechanismSet>()

export function loadMechanismProfile(raw = process.env.GRIST_MECH): MechanismProfile {
  const value = raw?.trim().toLowerCase()
  if (value === "off" || value === "none" || value === "0") return "off"
  if (value === "efficiency" || value === "efficient") return "efficiency"
  if (value === "performance" || value === "perf") return "performance"
  if (value === "auto") return "auto"
  return "auto"
}

/** Explicit effort from `GRIST_EFFORT`; undefined when unset or invalid so resolution can fall through. */
export function loadEffort(raw = process.env.GRIST_EFFORT): Effort | undefined {
  const value = raw?.trim().toLowerCase()
  if (value === "low" || value === "standard" || value === "high") return value
  return undefined
}

/**
 * Effort heuristic when no explicit env and no Jev Choice is available.
 * Exploration-heavy or multi-step work → high; trivial single-file work → low; otherwise standard.
 */
export function shadowEffort(text: string): Effort {
  const lower = text.toLowerCase()
  if (
    /(explor|investigat|diagnos|why is|what does|trace|profil|debug hang)/i.test(lower) ||
    /(refactor|migrate|across|end[- ]to[- ]end|multiple files|several files|all files|entire)/i.test(lower)
  ) {
    return "high"
  }
  if (/(one[- ]line|typo|single[- ]file|trivial|minor|small|rename|bump)/i.test(lower)) return "low"
  return "standard"
}

/** Heuristic when profile is auto (or Jev Choice unavailable). */
export function shadowMechanismChoice(text: string): {
  resolved: "efficiency" | "performance"
  exploration: boolean
  effort: Effort
  reasons: string[]
} {
  const lower = text.toLowerCase()
  const effort = shadowEffort(lower)
  const reasons: string[] = []

  // Exploration is the token sink: compress the subagent trace to a digest.
  if (/(explor|investigat|diagnos|why is|what does|trace|profil|debug hang)/i.test(lower)) {
    reasons.push("exploration_compressor")
    return { resolved: "efficiency", exploration: true, effort, reasons }
  }

  // Build/test/edit loops benefit from packing + fusion.
  if (/(test|build|lint|ci|fix|edit|implement|add|refactor)/i.test(lower)) {
    reasons.push("build_test_efficiency")
    return { resolved: "efficiency", exploration: false, effort, reasons }
  }

  reasons.push("default_efficiency")
  return { resolved: "efficiency", exploration: false, effort, reasons }
}

/**
 * Resolve effort: explicit `GRIST_EFFORT` wins, then a fallible Jev Choice when a key
 * is available, then the shadow heuristic. Jev failures fall back silently.
 */
export async function resolveEffort(text: string): Promise<{ effort: Effort; reason: string }> {
  const explicit = loadEffort()
  if (explicit) return { effort: explicit, reason: "effort_env" }
  const decided = await chooseEffortViaJev(text)
  if (decided) return { effort: decided, reason: "effort_jev" }
  const effort = shadowEffort(text)
  return { effort, reason: `effort_${effort}` }
}

async function chooseEffortViaJev(text: string): Promise<Effort | undefined> {
  if (!controlPlaneEnabled()) return undefined
  const route = resolveJevRoute()
  if (!route) return undefined
  try {
    const result = await askSystemOne({
      apiKey: route.apiKey,
      endpoint: route.endpoint,
      model: route.model,
      state: { product: "Grist", task: text },
      questions: {
        effort: {
          type: "choice",
          instructions:
            "How much effort should the coding agent spend on this task? Choose high for exploration-heavy or multi-step work, low for trivial single-file work, standard otherwise.",
          criteria: {
            low: "Trivial or single-file change",
            standard: "Normal task",
            high: "Exploration-heavy or multi-step task",
          },
        },
      },
    })
    const choice = (result.answers.effort as ChoiceAnswer | undefined)?.choice
    if (choice === "low" || choice === "standard" || choice === "high") return choice
    return undefined
  } catch (error) {
    gristWarn("[grist:mech] effort Jev failed; using shadow", error)
    return undefined
  }
}

export async function composeMechanisms(
  text: string,
  profile: MechanismProfile = loadMechanismProfile(),
): Promise<MechanismSet> {
  const choice = shadowMechanismChoice(text)
  const { effort, reason: effortReason } = await resolveEffort(text)

  if (profile === "off") {
    return {
      profile,
      resolved: "off",
      effort,
      observationPack: false,
      observationPackCompressor: false,
      actionFusion: false,
      reasons: ["mech_off", effortReason],
    }
  }

  if (profile === "efficiency") {
    return {
      profile,
      resolved: "efficiency",
      effort,
      observationPack: true,
      observationPackCompressor: true,
      actionFusion: true,
      reasons: ["mech_efficiency", effortReason],
    }
  }

  if (profile === "performance") {
    return {
      profile,
      resolved: "performance",
      effort,
      observationPack: false,
      observationPackCompressor: false,
      actionFusion: true,
      reasons: ["mech_performance", effortReason],
    }
  }

  return {
    profile: "auto",
    resolved: choice.resolved,
    effort,
    observationPack: choice.resolved === "efficiency",
    observationPackCompressor: choice.exploration,
    actionFusion: true,
    reasons: [...choice.reasons, effortReason],
  }
}

/** Remember per-session Choice so Tool.wrap / shell honor ObservationPack and the registry honors Action Fusion. */
export function rememberSessionMechanisms(sessionID: string, set: MechanismSet) {
  sessions.set(sessionID, set)
}

export function clearSessionMechanisms(sessionID: string) {
  sessions.delete(sessionID)
}

/** Session effort; `standard` when the session is unknown or has no resolved effort. */
export function sessionEffort(sessionID: string | undefined): Effort {
  if (!sessionID) return "standard"
  return sessions.get(sessionID)?.effort ?? "standard"
}

export function sessionAllowsObservationPack(sessionID: string | undefined): boolean {
  if (!sessionID) return true
  const set = sessions.get(sessionID)
  if (!set) return true
  return set.observationPack
}

export function sessionAllowsObservationPackCompressor(sessionID: string | undefined): boolean {
  if (!sessionID) return true
  const set = sessions.get(sessionID)
  if (!set) return true
  return set.observationPackCompressor
}

export function sessionAllowsActionFusion(sessionID: string | undefined): boolean {
  if (!sessionID) return true
  const set = sessions.get(sessionID)
  if (!set) return true
  return set.actionFusion
}
