export const ROUTES = [
  "local_model",
  "frontier_escalation",
  "ask_human",
] as const;

export type Route = (typeof ROUTES)[number];

export const TASK_STATUSES = [
  "queued",
  "gating",
  "running",
  "needs_human",
  "succeeded",
  "failed",
  "dismissed",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type NoulAnswer = {
  type: "noul";
  noul: number;
};

export type ChoiceAnswer<T extends string = string> = {
  type: "choice";
  choice: T;
  probabilities: Record<T, number>;
  confidence: number;
};

export type ScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};

export type GateAnswers = {
  localConfidence: ScoreAnswer;
  highStakes: NoulAnswer;
  underspecified: NoulAnswer;
  suggestedRoute: ChoiceAnswer<Route>;
};

export type GateProvider = "jev" | "shadow";

export type GateDecision = {
  route: Route;
  confidence: number;
  highStakes: number;
  underspecified: number;
  choice: Route;
  choiceConfidence: number;
  reasons: string[];
  latencyMs: number;
  provider: GateProvider;
  model: string;
  answers: GateAnswers;
  usage: TokenUsage;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type MemorySnippet = {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  path?: string;
  owner?: string;
  score: number;
};

export const MEMORY_KINDS = [
  "architecture",
  "convention",
  "ownership",
  "gotcha",
  "decision",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type AgentStep = {
  at: string;
  label: string;
  detail: string;
};

export type AgentResult = {
  summary: string;
  steps: AgentStep[];
  patch?: string;
  notes: string[];
};

export type Task = {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  route: Route | null;
  gate: GateDecision | null;
  retrieved: MemorySnippet[];
  result: AgentResult | null;
  tokens: {
    gate: TokenUsage;
    local: TokenUsage;
    frontier: TokenUsage;
  };
  costUsd: number;
  counterfactualFrontierUsd: number;
  createdAt: string;
  completedAt: string | null;
  seed: boolean;
  outcome: "local_success" | "local_failure" | "needed_escalation" | null;
};

export type GateSettings = {
  confidenceThreshold: number;
  unknownThreshold: number;
  highStakesThreshold: number;
  preferLiveJev: boolean;
};

export type HardwareTier = "pilot" | "team" | "department";

export type Appliance = {
  name: string;
  tier: HardwareTier;
  hardware: string;
  memoryGb: number;
  slots: number;
  model: string;
  modelSizeGb: number;
  inference: string;
  connected: boolean;
};

export type Metrics = {
  taskCount: number;
  localCount: number;
  frontierCount: number;
  humanCount: number;
  localShare: number | null;
  spendUsd: number;
  counterfactualFrontierUsd: number;
  savedUsd: number;
  gateLatencyMsP50: number | null;
  localTokens: number;
  frontierTokens: number;
  gateTokens: number;
};
