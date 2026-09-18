import type { ChoiceAnswer, Route, ScoreAnswer } from "@/lib/types";

export const LOCAL_CONFIDENCE_LEVELS = [
  "Almost certain to fail or produce unsafe output",
  "Likely to miss requirements or need substantial correction",
  "Even odds; a competent local attempt with notable risk",
  "Likely to succeed with a local pass plus review",
  "Routine for a well-indexed local agent",
] as const;

export const ROUTE_CRITERIA: Record<Route, string> = {
  local_model:
    "Well-scoped change the local 27B agent can complete with retrieved team memory",
  frontier_escalation:
    "Needs frontier reasoning, broad design, or high-stakes precision",
  ask_human:
    "Ambiguous, conflicting, or a judgment call the models should not make",
};

export function peakedDistribution(
  center: number,
  size: number,
  temperature = 0.42,
): number[] {
  const weights = Array.from({ length: size }, (_, i) => {
    const distance = Math.abs(i - center);
    return Math.exp(-((distance * distance) / (2 * temperature * temperature)));
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

export function weightedScore(probabilities: number[]): number {
  return probabilities.reduce((acc, p, i) => acc + p * i, 0);
}

export function choiceConfidence(probabilities: Record<string, number>): number {
  const values = Object.values(probabilities);
  const max = Math.max(...values);
  const entropy = values.reduce((acc, p) => {
    if (p <= 0) return acc;
    return acc - p * Math.log2(p);
  }, 0);
  const maxEntropy = Math.log2(Math.max(values.length, 2));
  const peaked = 1 - entropy / maxEntropy;
  return clamp01(0.35 * max + 0.65 * peaked);
}

export function toScoreAnswer(
  probabilities: number[],
  legend: readonly string[],
): ScoreAnswer {
  const map: Record<string, number> = {};
  const legendMap: Record<string, string> = {};
  probabilities.forEach((p, i) => {
    map[String(i)] = round4(p);
    legendMap[String(i)] = legend[i] ?? `Level ${i}`;
  });
  return {
    type: "score",
    score: round4(weightedScore(probabilities)),
    legend: legendMap,
    probabilities: map,
    confidence: round4(choiceConfidence(map)),
  };
}

export function toChoiceAnswer<T extends string>(
  probabilities: Record<T, number>,
): ChoiceAnswer<T> {
  const entries = Object.entries(probabilities) as [T, number][];
  const choice = entries.reduce((best, curr) =>
    curr[1] > best[1] ? curr : best,
  )[0];
  return {
    type: "choice",
    choice,
    probabilities,
    confidence: round4(choiceConfidence(probabilities)),
  };
}

export function normalizeScore(answer: ScoreAnswer): number {
  const max = Math.max(
    ...Object.keys(answer.legend).map((k) => Number(k)),
    1,
  );
  return clamp01(answer.score / max);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function estimateTokens(text: string): number {
  return Math.max(8, Math.round(text.length / 4));
}
