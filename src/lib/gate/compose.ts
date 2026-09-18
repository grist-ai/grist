import type { GateSettings, Route } from "@/lib/types";
import type { GateAnswers } from "@/lib/types";
import { normalizeScore } from "@/lib/gate/primitives";

export type ComposedDecision = {
  route: Route;
  confidence: number;
  reasons: string[];
};

export const DEFAULT_GATE_SETTINGS: GateSettings = {
  confidenceThreshold: 0.62,
  unknownThreshold: 0.72,
  highStakesThreshold: 0.75,
  preferLiveJev: true,
};

export function composeRoute(
  answers: GateAnswers,
  settings: GateSettings,
): ComposedDecision {
  const confidence = normalizeScore(answers.localConfidence);
  const unknown = answers.underspecified.noul;
  const stakes = answers.highStakes.noul;
  const reasons: string[] = [];

  if (unknown >= settings.unknownThreshold) {
    reasons.push("underspecified");
    return { route: "ask_human", confidence, reasons };
  }

  if (unknown >= 0.45 && answers.suggestedRoute.confidence < 0.5) {
    reasons.push("noul_uncertain");
    return { route: "ask_human", confidence, reasons };
  }

  if (stakes >= settings.highStakesThreshold) {
    reasons.push("high_stakes");
    return { route: "frontier_escalation", confidence, reasons };
  }

  if (confidence >= settings.confidenceThreshold) {
    reasons.push("confidence_above_threshold");
    return { route: "local_model", confidence, reasons };
  }

  reasons.push("confidence_below_threshold");
  return { route: "frontier_escalation", confidence, reasons };
}
