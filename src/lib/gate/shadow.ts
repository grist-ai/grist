import {
  LOCAL_CONFIDENCE_LEVELS,
  peakedDistribution,
  round4,
  toChoiceAnswer,
  toScoreAnswer,
} from "@/lib/gate/primitives";
import type { GateAnswers, Route } from "@/lib/types";

const HIGH_STAKES = [
  /\bauth(entication|oriz(e|ation))?\b/i,
  /\boauth\b/i,
  /\bjwt\b/i,
  /\bsecret/i,
  /\bcredential/i,
  /\bpassword\b/i,
  /\bpayment/i,
  /\bstripe\b/i,
  /\bbilling\b/i,
  /\bpayout/i,
  /\bledger\b/i,
  /\bmigrate\b|\bmigration\b/i,
  /\bproduction\b|\bprod\b/i,
  /\bdrop table\b/i,
  /\bdelete from\b/i,
  /\bencrypt/i,
  /\bcrypto\b/i,
  /\bgdpr\b/i,
  /\bpii\b/i,
  /\brls\b/i,
  /\biam\b/i,
  /\bsudo\b/i,
  /\bacl\b|\brbac\b/i,
];

const COMPLEX = [
  /\barchitect(ure|ing)?\b/i,
  /\bredesign\b/i,
  /\brewrite\b/i,
  /\bfrom scratch\b/i,
  /\bdistributed\b/i,
  /\bmulti-tenant\b/i,
  /\bnew (system|service|framework|protocol)\b/i,
  /\bdesign a\b/i,
  /\bconsensus\b/i,
  /\bcapacity plan/i,
];

const ROUTINE = [
  /\btypo\b/i,
  /\brename\b/i,
  /\blint\b/i,
  /\bformat\b/i,
  /\bprettier\b/i,
  /\bcomment/i,
  /\bcss\b/i,
  /\bmobile\b/i,
  /\bcopy\b|\bwording\b/i,
  /\breadme\b/i,
  /\bdocument\b/i,
  /\badd (a |an )?(unit |regression )?test/i,
  /\bregression test\b/i,
  /\bfix (the )?import/i,
  /\bdead code\b/i,
  /\bunused\b/i,
  /\bcall sites?\b/i,
];

const VAGUE = [
  /\bfix it\b/i,
  /\bmake it work\b/i,
  /\bsomething is (broken|wrong)\b/i,
  /\bhandle this\b/i,
  /\blook into\b/i,
  /\bimprove (it|this)\b/i,
];

const FILE_PATH =
  /\b[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|md|css|sql|json|yml|yaml)\b/;

export type ShadowSignals = {
  highStakes: number;
  complexity: number;
  routine: number;
  vague: number;
  specificity: number;
  promptChars: number;
};

export function extractSignals(prompt: string): ShadowSignals {
  const text = prompt.trim();
  const highStakes = hitRate(text, HIGH_STAKES);
  const complexity = hitRate(text, COMPLEX);
  const routine = hitRate(text, ROUTINE);
  const vague = hitRate(text, VAGUE);
  const fileHits = text.match(new RegExp(FILE_PATH.source, "gi"))?.length ?? 0;
  const lines = text.split("\n").filter((l) => l.trim()).length;
  const hasAcceptance = /\b(should|must|expect|acceptance)\b/i.test(text);
  const specificity = clamp(
    (fileHits >= 1 ? 0.45 : 0) +
      (lines >= 3 ? 0.2 : 0) +
      (text.length > 160 ? 0.15 : 0) +
      (hasAcceptance ? 0.2 : 0) +
      (/\b(function|class|component|helper|test)\b/i.test(text) ? 0.1 : 0),
    0,
    1,
  );

  return {
    highStakes,
    complexity,
    routine,
    vague,
    specificity,
    promptChars: text.length,
  };
}

export function shadowAnswers(prompt: string): GateAnswers {
  const signals = extractSignals(prompt);
  const tooShort = signals.promptChars < 28;
  const underspecified = clamp(
    (tooShort ? 0.55 : 0) +
      signals.vague * 0.55 +
      (1 - signals.specificity) * 0.35 -
      signals.routine * 0.1,
    0.04,
    0.97,
  );

  const highStakes = clamp(0.06 + signals.highStakes * 0.85, 0.03, 0.97);
  const scopedMundane =
    signals.specificity >= 0.4 && highStakes < 0.2 && signals.complexity < 0.2
      ? 0.14
      : 0;

  const localRaw = clamp(
    0.54 +
      signals.routine * 0.4 +
      signals.specificity * 0.28 +
      scopedMundane -
      signals.complexity * 0.38 -
      highStakes * 0.22 -
      underspecified * 0.2,
    0.04,
    0.96,
  );

  const center = localRaw * (LOCAL_CONFIDENCE_LEVELS.length - 1);
  const localConfidence = toScoreAnswer(
    peakedDistribution(center, LOCAL_CONFIDENCE_LEVELS.length),
    LOCAL_CONFIDENCE_LEVELS,
  );

  const localMass = clamp(localRaw * (1 - highStakes) * (1 - underspecified), 0.05, 0.9);
  const humanMass = clamp(underspecified, 0.04, 0.9);
  const frontierMass = clamp(
    1 - localMass - humanMass * 0.7 + highStakes * 0.45 + signals.complexity * 0.3,
    0.05,
    0.9,
  );

  const suggestedRoute = toChoiceAnswer(normalizeRouteMass({
    local_model: localMass,
    frontier_escalation: frontierMass,
    ask_human: humanMass,
  }));

  return {
    localConfidence,
    highStakes: { type: "noul", noul: round4(highStakes) },
    underspecified: { type: "noul", noul: round4(underspecified) },
    suggestedRoute,
  };
}

function hitRate(text: string, patterns: RegExp[]): number {
  if (patterns.length === 0) return 0;
  const hits = patterns.filter((p) => p.test(text)).length;
  return Math.min(1, hits / 2);
}

function normalizeRouteMass(mass: Record<Route, number>): Record<Route, number> {
  const sum = mass.local_model + mass.frontier_escalation + mass.ask_human;
  return {
    local_model: round4(mass.local_model / sum),
    frontier_escalation: round4(mass.frontier_escalation / sum),
    ask_human: round4(mass.ask_human / sum),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
