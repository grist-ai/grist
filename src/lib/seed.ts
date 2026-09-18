import { composeRoute, DEFAULT_GATE_SETTINGS } from "@/lib/gate/compose";
import { shadowAnswers } from "@/lib/gate/shadow";
import { retrieveMemory } from "@/lib/memory/retrieve";
import {
  counterfactualFrontierCost,
  simulateAgent,
} from "@/lib/agent/simulate";
import { titleFromPrompt } from "@/lib/format";
import { round4 } from "@/lib/gate/primitives";
import type { GateDecision, Route, Task, TaskStatus } from "@/lib/types";

type SeedSpec = {
  id: string;
  prompt: string;
  hoursAgo: number;
  latencyMs: number;
  outcome: Task["outcome"];
  status?: TaskStatus;
};

const SPECS: SeedSpec[] = [
  {
    id: "tsk_seed_01",
    prompt:
      "Rename the unused `fetchLegacyMap` helper in src/graph/map.ts and update call sites.",
    hoursAgo: 6,
    latencyMs: 118,
    outcome: "local_success",
  },
  {
    id: "tsk_seed_02",
    prompt:
      "Add a regression test for the ownership miner skipping bot commits and merges.",
    hoursAgo: 14,
    latencyMs: 94,
    outcome: "local_success",
  },
  {
    id: "tsk_seed_03",
    prompt:
      "We're seeing duplicate charges in payouts — redesign the ledger to be idempotent and migrate production.",
    hoursAgo: 20,
    latencyMs: 211,
    outcome: "needed_escalation",
  },
  {
    id: "tsk_seed_04",
    prompt: "Fix it.",
    hoursAgo: 26,
    latencyMs: 87,
    outcome: null,
    status: "needs_human",
  },
  {
    id: "tsk_seed_05",
    prompt:
      "Tighten the CSS on the payout receipt so the amount does not wrap on mobile.",
    hoursAgo: 40,
    latencyMs: 102,
    outcome: "local_success",
  },
  {
    id: "tsk_seed_06",
    prompt:
      "Design a multi-tenant auth rewrite with JWT rotation and migrate every production tenant this week.",
    hoursAgo: 52,
    latencyMs: 188,
    outcome: "needed_escalation",
  },
  {
    id: "tsk_seed_07",
    prompt:
      "Document the no-inline-imports convention in AGENTS.md with a one-line example.",
    hoursAgo: 70,
    latencyMs: 76,
    outcome: "local_success",
  },
  {
    id: "tsk_seed_08",
    prompt:
      "Look into the graph. Something is wrong.",
    hoursAgo: 88,
    latencyMs: 143,
    outcome: null,
    status: "needs_human",
  },
];

export function seedTasks(): Task[] {
  return SPECS.map(buildSeed);
}

function buildSeed(spec: SeedSpec): Task {
  const created = new Date(Date.now() - spec.hoursAgo * 3600 * 1000);
  const answers = shadowAnswers(spec.prompt);
  const composed = composeRoute(answers, DEFAULT_GATE_SETTINGS);
  const route = composed.route;
  const retrieved = retrieveMemory(spec.prompt);
  const gate: GateDecision = {
    route,
    confidence: composed.confidence,
    highStakes: answers.highStakes.noul,
    underspecified: answers.underspecified.noul,
    choice: answers.suggestedRoute.choice,
    choiceConfidence: answers.suggestedRoute.confidence,
    reasons: composed.reasons,
    latencyMs: spec.latencyMs,
    provider: "shadow",
    model: "jev-shadow",
    answers,
    usage: { inputTokens: 640, outputTokens: 0, costUsd: 0.00003 },
  };

  const task: Task = {
    id: spec.id,
    title: titleFromPrompt(spec.prompt),
    prompt: spec.prompt,
    status: spec.status ?? "succeeded",
    route,
    gate,
    retrieved,
    result: null,
    tokens: {
      gate: gate.usage,
      local: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      frontier: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    },
    costUsd: gate.usage.costUsd,
    counterfactualFrontierUsd: counterfactualFrontierCost(spec.prompt),
    createdAt: created.toISOString(),
    completedAt: spec.status === "needs_human" ? null : new Date(created.getTime() + 8_000).toISOString(),
    seed: true,
    outcome: spec.outcome,
  };

  if (spec.status === "needs_human" || route === "ask_human") {
    const simulated = simulateAgent({
      prompt: spec.prompt,
      route: "ask_human",
      retrieved,
      now: created,
    });
    task.result = simulated.result;
    task.status = "needs_human";
    task.route = "ask_human";
    return task;
  }

  const simulated = simulateAgent({
    prompt: spec.prompt,
    route: route as Exclude<Route, "ask_human">,
    retrieved,
    now: created,
  });
  task.result = simulated.result;
  if (route === "local_model") task.tokens.local = simulated.usage;
  if (route === "frontier_escalation") task.tokens.frontier = simulated.usage;
  task.costUsd = round4(
    task.tokens.gate.costUsd +
      task.tokens.local.costUsd +
      task.tokens.frontier.costUsd,
  );
  return task;
}
