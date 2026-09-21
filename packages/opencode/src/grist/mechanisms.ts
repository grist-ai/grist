/**
 * SoL-Pi mechanism Choice (pre-POC §5).
 *
 * Per-task set of harness mechanisms, routable via the gate:
 * - ObservationPack — pack large tool outputs
 * - Action Fusion — prefer edit_verify over edit→bash
 *
 * Profiles mirror SoL-Pi [Efficiency] vs [Performance]:
 * - efficiency — both on (token cuts)
 * - performance — ObservationPack off (full fidelity); fusion still on
 * - auto — pick from task text (default)
 * - off — both off
 */

export type MechanismProfile = "auto" | "efficiency" | "performance" | "off"

export type MechanismSet = {
  profile: MechanismProfile
  resolved: "efficiency" | "performance" | "off"
  observationPack: boolean
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

/** Heuristic when profile is auto (or Jev Choice unavailable). */
export function shadowMechanismChoice(text: string): {
  resolved: "efficiency" | "performance"
  reasons: string[]
} {
  const lower = text.toLowerCase()
  const reasons: string[] = []

  // Exploration / diagnosis benefits from full tool output fidelity.
  if (/(explor|investigat|diagnos|why is|what does|trace|profil|debug hang)/i.test(lower)) {
    reasons.push("exploration_performance")
    return { resolved: "performance", reasons }
  }

  // Build/test/edit loops benefit from packing + fusion.
  if (/(test|build|lint|ci|fix|edit|implement|add|refactor)/i.test(lower)) {
    reasons.push("build_test_efficiency")
    return { resolved: "efficiency", reasons }
  }

  reasons.push("default_efficiency")
  return { resolved: "efficiency", reasons }
}

export function composeMechanisms(
  text: string,
  profile: MechanismProfile = loadMechanismProfile(),
): MechanismSet {
  if (profile === "off") {
    return {
      profile,
      resolved: "off",
      observationPack: false,
      actionFusion: false,
      reasons: ["mech_off"],
    }
  }

  if (profile === "efficiency") {
    return {
      profile,
      resolved: "efficiency",
      observationPack: true,
      actionFusion: true,
      reasons: ["mech_efficiency"],
    }
  }

  if (profile === "performance") {
    return {
      profile,
      resolved: "performance",
      observationPack: false,
      actionFusion: true,
      reasons: ["mech_performance"],
    }
  }

  const choice = shadowMechanismChoice(text)
  return {
    profile: "auto",
    resolved: choice.resolved,
    observationPack: choice.resolved === "efficiency",
    actionFusion: true,
    reasons: choice.reasons,
  }
}

/** Remember per-session Choice so Tool.wrap / shell honor ObservationPack and the registry honors Action Fusion. */
export function rememberSessionMechanisms(sessionID: string, set: MechanismSet) {
  sessions.set(sessionID, set)
}

export function clearSessionMechanisms(sessionID: string) {
  sessions.delete(sessionID)
}

export function sessionAllowsObservationPack(sessionID: string | undefined): boolean {
  if (!sessionID) return true
  const set = sessions.get(sessionID)
  if (!set) return true
  return set.observationPack
}

export function sessionAllowsActionFusion(sessionID: string | undefined): boolean {
  if (!sessionID) return true
  const set = sessions.get(sessionID)
  if (!set) return true
  return set.actionFusion
}
