/** Calibrated gate thresholds (pre-POC §4 / §8.6). Defaults are placeholders. */

export type GateThresholds = {
  /** Difficulty ≥ this → medium */
  difficultyMedium: number
  /** Difficulty ≥ this → frontier */
  difficultyFrontier: number
  /** Difficulty ≥ this → premium (top judge score only) */
  difficultyPremium: number
  /** Underspecified ≥ this → force cheapest */
  underspecifiedCheapest: number
  /** Sensitivity ≥ this → cap at cheapest */
  sensitivityCapCheapest: number
  /** Sensitivity ≥ this → cap at medium */
  sensitivityCapMedium: number
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  difficultyMedium: 0.4,
  difficultyFrontier: 0.75,
  difficultyPremium: 0.9,
  underspecifiedCheapest: 0.7,
  sensitivityCapCheapest: 0.75,
  sensitivityCapMedium: 0.45,
}

function num(env: string | undefined, fallback: number) {
  if (env === undefined || env === "") return fallback
  const n = Number(env)
  if (Number.isNaN(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/** Load thresholds from env overrides (set after burn-in calibration). */
export function loadThresholds(env: NodeJS.ProcessEnv = process.env): GateThresholds {
  return {
    difficultyMedium: num(env.GRIST_TH_DIFF_MEDIUM, DEFAULT_THRESHOLDS.difficultyMedium),
    difficultyFrontier: num(env.GRIST_TH_DIFF_FRONTIER, DEFAULT_THRESHOLDS.difficultyFrontier),
    difficultyPremium: num(env.GRIST_TH_DIFF_PREMIUM, DEFAULT_THRESHOLDS.difficultyPremium),
    underspecifiedCheapest: num(env.GRIST_TH_UNDER_CHEAPEST, DEFAULT_THRESHOLDS.underspecifiedCheapest),
    sensitivityCapCheapest: num(env.GRIST_TH_SENS_CHEAPEST, DEFAULT_THRESHOLDS.sensitivityCapCheapest),
    sensitivityCapMedium: num(env.GRIST_TH_SENS_MEDIUM, DEFAULT_THRESHOLDS.sensitivityCapMedium),
  }
}

export function loadThresholdsFromJson(raw: unknown): GateThresholds {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_THRESHOLDS }
  const o = raw as Record<string, unknown>
  const pick = (key: keyof GateThresholds) => {
    const v = o[key]
    return typeof v === "number" && !Number.isNaN(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_THRESHOLDS[key]
  }
  return {
    difficultyMedium: pick("difficultyMedium"),
    difficultyFrontier: pick("difficultyFrontier"),
    difficultyPremium: pick("difficultyPremium"),
    underspecifiedCheapest: pick("underspecifiedCheapest"),
    sensitivityCapCheapest: pick("sensitivityCapCheapest"),
    sensitivityCapMedium: pick("sensitivityCapMedium"),
  }
}
