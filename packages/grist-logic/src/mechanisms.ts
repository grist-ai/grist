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

export type MechanismProfile = "auto" | "efficiency" | "performance" | "off"

export type MechanismSet = {
  profile: MechanismProfile
  resolved: "efficiency" | "performance" | "off"
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

/** Heuristic when profile is auto (or Jev Choice unavailable). */
export function shadowMechanismChoice(text: string): {
  resolved: "efficiency" | "performance"
  exploration: boolean
  reasons: string[]
} {
  const lower = text.toLowerCase()
  const reasons: string[] = []

  // Exploration is the token sink: compress the subagent trace to a digest.
  if (/(explor|investigat|diagnos|why is|what does|trace|profil|debug hang)/i.test(lower)) {
    reasons.push("exploration_compressor")
    return { resolved: "efficiency", exploration: true, reasons }
  }

  // Build/test/edit loops benefit from packing + fusion.
  if (/(test|build|lint|ci|fix|edit|implement|add|refactor)/i.test(lower)) {
    reasons.push("build_test_efficiency")
    return { resolved: "efficiency", exploration: false, reasons }
  }

  reasons.push("default_efficiency")
  return { resolved: "efficiency", exploration: false, reasons }
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
      observationPackCompressor: false,
      actionFusion: false,
      reasons: ["mech_off"],
    }
  }

  if (profile === "efficiency") {
    return {
      profile,
      resolved: "efficiency",
      observationPack: true,
      observationPackCompressor: true,
      actionFusion: true,
      reasons: ["mech_efficiency"],
    }
  }

  if (profile === "performance") {
    return {
      profile,
      resolved: "performance",
      observationPack: false,
      observationPackCompressor: false,
      actionFusion: true,
      reasons: ["mech_performance"],
    }
  }

  const choice = shadowMechanismChoice(text)
  return {
    profile: "auto",
    resolved: choice.resolved,
    observationPack: choice.resolved === "efficiency",
    observationPackCompressor: choice.exploration,
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
