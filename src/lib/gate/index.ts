import { composeRoute } from "@/lib/gate/compose";
import { evaluateTask } from "@/lib/gate/evaluate";
import type { GateDecision, GateSettings } from "@/lib/types";

export async function runGate(
  prompt: string,
  settings: GateSettings,
): Promise<GateDecision> {
  const evaluation = await evaluateTask(prompt);
  const composed = composeRoute(evaluation.answers, settings);

  return {
    route: composed.route,
    confidence: composed.confidence,
    highStakes: evaluation.answers.highStakes.noul,
    underspecified: evaluation.answers.underspecified.noul,
    choice: evaluation.answers.suggestedRoute.choice,
    choiceConfidence: evaluation.answers.suggestedRoute.confidence,
    reasons: composed.reasons,
    latencyMs: evaluation.latencyMs,
    provider: evaluation.provider,
    model: evaluation.model,
    answers: evaluation.answers,
    usage: evaluation.usage,
  };
}

export { composeRoute } from "@/lib/gate/compose";
export { DEFAULT_GATE_SETTINGS } from "@/lib/gate/compose";
export { shadowAnswers } from "@/lib/gate/shadow";
