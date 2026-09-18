import type { MemoryKind } from "@/lib/types";

export type MemoryRecord = {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  path?: string;
  owner?: string;
  terms: string[];
};

export const TEAM_NAME = "Prosh";
export const SNAPSHOT_SHA = "9f3c1a2";

export const MEMORY_CATALOG: MemoryRecord[] = [
  {
    id: "mem_arch_graph",
    kind: "architecture",
    title: "Code map lives in src/graph, never in the agent loop",
    body: "The Prosh graph is a deterministic AST map. Agents retrieve blast radius from src/graph; they do not rebuild it mid-task. Imports, not presence, decide whether a file is live.",
    path: "src/graph/map.ts",
    owner: "n.okonkwo",
    terms: ["graph", "map", "tree-sitter", "blast", "src/graph", "map.ts"],
  },
  {
    id: "mem_arch_ledger",
    kind: "architecture",
    title: "Payouts go through the ledger, not Stripe directly",
    body: "All money movement is an append-only ledger in payments/ledger. Stripe is an adapter. Duplicate charges are a ledger idempotency bug until proven otherwise.",
    path: "payments/ledger/posting.ts",
    owner: "a.rahi",
    terms: [
      "payout",
      "ledger",
      "stripe",
      "charge",
      "payment",
      "idempotent",
      "billing",
    ],
  },
  {
    id: "mem_own_graph",
    kind: "ownership",
    title: "src/graph — n.okonkwo (18 months, 61% of commits)",
    body: "Mined from git history, skipping merges and dependabot. Secondary: j.park on watchers. Review comments on graph PRs are convention gold.",
    path: "src/graph",
    owner: "n.okonkwo",
    terms: ["ownership", "graph", "okonkwo", "pydriller"],
  },
  {
    id: "mem_own_payments",
    kind: "ownership",
    title: "payments/* — a.rahi, on-call with s.cho",
    body: "Rahi authored the posting engine. Cho owns reconciliation jobs. Do not land ledger migrations without one of them on the review.",
    path: "payments",
    owner: "a.rahi",
    terms: ["payments", "ledger", "rahi", "cho", "on-call", "migration"],
  },
  {
    id: "mem_own_miner",
    kind: "ownership",
    title: "Ownership miner skips bots and merges",
    body: "src/ownership/miner.py uses pydriller over the last 18 months. Merge commits and authors matching dependabot|renovate|github-actions are dropped before scoring.",
    path: "src/ownership/miner.py",
    owner: "j.park",
    terms: ["ownership", "miner", "bot", "pydriller", "merge", "test"],
  },
  {
    id: "mem_conv_tests",
    kind: "convention",
    title: "Regression tests live next to the miner, not in /e2e",
    body: "Unit tests for deterministic rules (bot skip, date bounds, dedup) stay as code beside the module. Do not send those judgments through Jev.",
    path: "src/ownership/miner_test.py",
    owner: "j.park",
    terms: ["test", "regression", "bot", "miner", "convention"],
  },
  {
    id: "mem_conv_imports",
    kind: "convention",
    title: "No inline imports",
    body: "Imports stay at the top of the module. Inline imports in function bodies are a review reject unless a circular-dependency comment is present.",
    path: "AGENTS.md",
    owner: "n.okonkwo",
    terms: ["import", "inline", "convention", "helper", "rename"],
  },
  {
    id: "mem_gotcha_legacy_map",
    kind: "gotcha",
    title: "fetchLegacyMap is dead; callers should use buildMap",
    body: "fetchLegacyMap survived a rewrite. It still compiles. Churn and inbound imports are both zero — do not 'fix' it; delete or rename through call-site search.",
    path: "src/graph/map.ts",
    owner: "n.okonkwo",
    terms: ["fetchlegacymap", "legacy", "map.ts", "rename", "unused", "helper"],
  },
  {
    id: "mem_gotcha_shadow",
    kind: "gotcha",
    title: "Gate thresholds are measured, never guessed",
    body: "The 70% local split is a hypothesis until shadow burn-in labels tasks. Do not bake it into pricing copy or the default threshold.",
    path: "src/gate/settings.ts",
    owner: "s.cho",
    terms: ["gate", "threshold", "shadow", "local", "hypothesis"],
  },
  {
    id: "mem_adr_sandbox",
    kind: "decision",
    title: "ADR-014: Docker sandbox on the box for v1",
    body: "Agent tool runs stay in a local Docker sandbox. E2B Runtime is the scale-up path, not the pilot. Size RAM for sandbox spikes, not just inference.",
    path: "docs/adr/014-sandbox.md",
    owner: "s.cho",
    terms: ["sandbox", "docker", "e2b", "adr", "hardware"],
  },
];

export const BOOTSTRAP_STEPS = [
  {
    id: "snapshot",
    title: "Snapshot",
    detail: `Pinned ${SNAPSHOT_SHA} on origin/main.`,
    status: "done" as const,
  },
  {
    id: "map",
    title: "Code-map build",
    detail: "Tree-sitter pass over 412k LOC. Graphify vs CRG bake-off still open.",
    status: "done" as const,
  },
  {
    id: "history",
    title: "Bounded git history",
    detail: "18 months, merges and bots skipped, sharded by path prefix.",
    status: "done" as const,
  },
  {
    id: "reviews",
    title: "PR / review ingestion",
    detail: "Ranked by discussion depth. GitHub GraphQL, rate-limit friendly.",
    status: "done" as const,
  },
  {
    id: "distill",
    title: "Map-reduce distillation",
    detail:
      "The one bootstrap step that spends frontier tokens. Seeded from a prior run (~$80).",
    status: "done" as const,
  },
  {
    id: "seed",
    title: "Seed team profile",
    detail: "Architecture, ownership, conventions, gotchas loaded into memory.",
    status: "done" as const,
  },
  {
    id: "shadow",
    title: "Shadow burn-in",
    detail: "Live tasks become labeled examples. Thresholds stay editable.",
    status: "running" as const,
  },
];
