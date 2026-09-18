import {
  LOCAL_CONFIDENCE_LEVELS,
  ROUTE_CRITERIA,
  estimateTokens,
  round4,
  toChoiceAnswer,
  toScoreAnswer,
} from "@/lib/gate/primitives";
import { shadowAnswers } from "@/lib/gate/shadow";
import type {
  ChoiceAnswer,
  GateAnswers,
  GateProvider,
  NoulAnswer,
  Route,
  ScoreAnswer,
  TokenUsage,
} from "@/lib/types";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_INPUT_USD_PER_MTOK = 0.042;

export type EvaluatorResult = {
  answers: GateAnswers;
  provider: GateProvider;
  model: string;
  latencyMs: number;
  usage: TokenUsage;
};

export async function evaluateTask(prompt: string): Promise<EvaluatorResult> {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (key) {
    try {
      return await evaluateWithJev(prompt, key);
    } catch (error) {
      console.warn("Jev live call failed; using shadow evaluator", error);
    }
  }
  return evaluateWithShadow(prompt);
}

async function evaluateWithShadow(prompt: string): Promise<EvaluatorResult> {
  const started = Date.now();
  await sleep(80 + Math.round(Math.random() * 90));
  const answers = shadowAnswers(prompt);
  const latencyMs = Date.now() - started;
  const inputTokens = estimateTokens(JSON.stringify({ prompt, questions: questionPayload() }));
  return {
    answers,
    provider: "shadow",
    model: "jev-shadow",
    latencyMs,
    usage: {
      inputTokens,
      outputTokens: 0,
      costUsd: round4((inputTokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK),
    },
  };
}

async function evaluateWithJev(
  prompt: string,
  apiKey: string,
): Promise<EvaluatorResult> {
  const started = Date.now();
  const body = {
    model: "jev-latest",
    state: {
      task: prompt,
      hardware: "local Bonsai 2 27B via llama.cpp",
      knowledge:
        "Team memory (code map, conventions, ownership) is retrieved before the agent runs.",
    },
    questions: questionPayload(),
  };

  const response = await fetch(JEV_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Jev HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    model?: string;
    answers: Record<string, unknown>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const answers = parseJevAnswers(json.answers);
  const inputTokens = json.usage?.input_tokens ?? estimateTokens(JSON.stringify(body));
  const outputTokens = json.usage?.output_tokens ?? 0;

  return {
    answers,
    provider: "jev",
    model: json.model ?? "jev-latest",
    latencyMs: Date.now() - started,
    usage: {
      inputTokens,
      outputTokens,
      costUsd: round4((inputTokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK),
    },
  };
}

function questionPayload() {
  return {
    local_confidence: {
      type: "score",
      instructions:
        "How likely is a 27B local coding model with retrieved team conventions to complete `task` correctly without frontier help?",
      criteria: [...LOCAL_CONFIDENCE_LEVELS],
    },
    high_stakes: {
      type: "noul",
      instructions:
        "Would a wrong change for `task` cause security, data-loss, billing, or production-outage risk?",
      criteria: {
        true: "auth, secrets, payments, migrations, destructive or production operations",
        false: "isolated, reversible, non-production work",
      },
    },
    underspecified: {
      type: "noul",
      instructions:
        "Is `task` too underspecified to act on without a human clarifying the goal, files, or constraints?",
      criteria: {
        true: "goal, files, or success criteria are missing or contradictory",
        false: "an engineer could start immediately from the text as written",
      },
    },
    suggested_route: {
      type: "choice",
      instructions: "Which execution lane should take `task`?",
      criteria: ROUTE_CRITERIA,
    },
  };
}

function parseJevAnswers(raw: Record<string, unknown>): GateAnswers {
  return {
    localConfidence: parseScore(raw.local_confidence),
    highStakes: parseNoul(raw.high_stakes),
    underspecified: parseNoul(raw.underspecified),
    suggestedRoute: parseRouteChoice(raw.suggested_route),
  };
}

function parseNoul(value: unknown): NoulAnswer {
  if (
    value &&
    typeof value === "object" &&
    "noul" in value &&
    typeof (value as { noul: unknown }).noul === "number"
  ) {
    return { type: "noul", noul: (value as { noul: number }).noul };
  }
  throw new Error("Invalid noul answer from Jev");
}

function parseScore(value: unknown): ScoreAnswer {
  if (value && typeof value === "object" && "score" in value) {
    const v = value as {
      score: number;
      legend?: Record<string, string>;
      probabilities?: Record<string, number>;
      confidence?: number;
    };
    if (v.probabilities && v.legend) {
      return {
        type: "score",
        score: v.score,
        legend: v.legend,
        probabilities: v.probabilities,
        confidence: v.confidence ?? 0.5,
      };
    }
  }
  return toScoreAnswer(
    [0.1, 0.15, 0.3, 0.3, 0.15],
    LOCAL_CONFIDENCE_LEVELS,
  );
}

function parseRouteChoice(value: unknown): ChoiceAnswer<Route> {
  if (value && typeof value === "object" && "choice" in value) {
    const v = value as {
      choice: string;
      probabilities?: Record<string, number>;
      confidence?: number;
    };
    const probabilities: Record<Route, number> = {
      local_model: v.probabilities?.local_model ?? 0,
      frontier_escalation: v.probabilities?.frontier_escalation ?? 0,
      ask_human: v.probabilities?.ask_human ?? 0,
    };
    if (isRoute(v.choice)) {
      if (probabilities[v.choice] === 0) probabilities[v.choice] = 1;
      const parsed = toChoiceAnswer(probabilities);
      return { ...parsed, choice: v.choice, confidence: v.confidence ?? parsed.confidence };
    }
  }
  return toChoiceAnswer({
    local_model: 0.34,
    frontier_escalation: 0.33,
    ask_human: 0.33,
  });
}

function isRoute(value: string): value is Route {
  return (
    value === "local_model" ||
    value === "frontier_escalation" ||
    value === "ask_human"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
