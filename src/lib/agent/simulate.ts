import { assertNever } from "@/lib/never";
import { round4 } from "@/lib/gate/primitives";
import type {
  AgentResult,
  MemorySnippet,
  Route,
  TokenUsage,
} from "@/lib/types";

const FRONTIER_IN_USD = 3 / 1_000_000;
const FRONTIER_OUT_USD = 15 / 1_000_000;

export function simulateAgent(input: {
  prompt: string;
  route: Route;
  retrieved: MemorySnippet[];
  now?: Date;
}): { result: AgentResult; usage: TokenUsage } {
  const now = input.now ?? new Date();
  switch (input.route) {
    case "ask_human":
      return {
        result: {
          summary:
            "Held for a human. The gate will not invent a goal when the task is underspecified or contradictory.",
          steps: [
            step(now, 0, "Gate", "Noul unknown / ask-human. No model invoked."),
          ],
          notes: [
            "Reply with the files, the success condition, or an explicit route override.",
          ],
        },
        usage: zeroUsage(),
      };
    case "local_model":
      return localPass(input.prompt, input.retrieved, now);
    case "frontier_escalation":
      return frontierPass(input.prompt, input.retrieved, now);
    default:
      return assertNever(input.route);
  }
}

export function counterfactualFrontierCost(prompt: string): number {
  const inputTokens = 1800 + Math.round(prompt.length / 3);
  const outputTokens = 900 + Math.min(2400, Math.round(prompt.length / 2));
  return round4(inputTokens * FRONTIER_IN_USD + outputTokens * FRONTIER_OUT_USD);
}

function localPass(
  prompt: string,
  retrieved: MemorySnippet[],
  now: Date,
): { result: AgentResult; usage: TokenUsage } {
  const memory = retrieved[0];
  const inputTokens = 2400 + retrieved.length * 180 + Math.round(prompt.length / 4);
  const outputTokens = 650 + Math.round(prompt.length / 6);
  return {
    result: {
      summary:
        "Local Bonsai 2 27B completed a bounded change using retrieved team memory. Review the patch before merge — local is cheap, not infallible.",
      steps: [
        step(now, 0, "Retrieve", `Loaded ${retrieved.length} memory snippets.`),
        step(
          now,
          900,
          "Local loop",
          memory
            ? `Conditioned on “${memory.title}”.`
            : "No strong memory hit; used repo conventions only.",
        ),
        step(now, 2400, "Patch", "Drafted a scoped edit. Sandbox would run tests here."),
      ],
      patch: localPatch(prompt, memory),
      notes: [
        "Zero marginal model cost. Hardware amortization is the spend.",
        "Sandbox test runs are the spikiest load on the box — not this draft.",
      ],
    },
    usage: {
      inputTokens,
      outputTokens,
      costUsd: 0,
    },
  };
}

function frontierPass(
  prompt: string,
  retrieved: MemorySnippet[],
  now: Date,
): { result: AgentResult; usage: TokenUsage } {
  const inputTokens = 4200 + retrieved.length * 220 + Math.round(prompt.length / 3);
  const outputTokens = 1400 + Math.round(prompt.length / 2);
  return {
    result: {
      summary:
        "Escalated to a frontier model. High-stakes or low-confidence work stays metered and logged.",
      steps: [
        step(now, 0, "Retrieve", `Loaded ${retrieved.length} memory snippets.`),
        step(
          now,
          400,
          "Escalate",
          "Task left the box. Code and memory in this prompt are the only data that leave hardware.",
        ),
        step(now, 3200, "Frontier pass", "Returned a design-aware patch with failure modes."),
      ],
      patch: frontierPatch(prompt, retrieved[0]),
      notes: [
        "Frontier tokens are the number the POC has to beat.",
        "This slice simulates the metered call; wire Claude/GPT in Phase 5 once the Jev key lands.",
      ],
    },
    usage: {
      inputTokens,
      outputTokens,
      costUsd: round4(inputTokens * FRONTIER_IN_USD + outputTokens * FRONTIER_OUT_USD),
    },
  };
}

function localPatch(prompt: string, memory?: MemorySnippet): string {
  if (/fetchLegacyMap/i.test(prompt) || /rename/i.test(prompt)) {
    return `diff --git a/src/graph/map.ts b/src/graph/map.ts
--- a/src/graph/map.ts
+++ b/src/graph/map.ts
@@ export function fetchLegacyMap() {
-export function fetchLegacyMap() {
-  return buildMap({ includeDead: true });
-}
+// Removed unused fetchLegacyMap. Callers use buildMap().
`;
  }
  if (/test/i.test(prompt) && /bot/i.test(prompt)) {
    return `diff --git a/src/ownership/miner_test.py b/src/ownership/miner_test.py
@@
+def test_skips_dependabot_and_merges():
+    commits = [
+        FakeCommit(author="dependabot[bot]", is_merge=False),
+        FakeCommit(author="n.okonkwo", is_merge=True),
+        FakeCommit(author="n.okonkwo", is_merge=False),
+    ]
+    assert score(commits)["n.okonkwo"] == 1
`;
  }
  return `diff --git a/src/agent/task.py b/src/agent/task.py
@@
+# Local pass against: ${truncate(prompt, 88)}
+# Memory: ${memory?.title ?? "team conventions"}
`;
}

function frontierPatch(prompt: string, memory?: MemorySnippet): string {
  if (/ledger|payout|charge/i.test(prompt)) {
    return `diff --git a/payments/ledger/posting.ts b/payments/ledger/posting.ts
@@
 export async function postCharge(input: ChargeInput) {
+  const key = idempotencyKey(input.orderId, input.attempt);
+  const existing = await ledger.findByKey(key);
+  if (existing) return existing; // never double-capture
   const row = await ledger.append({ ...input, key });
   await stripe.adapter.capture(row);
   return row;
 }
`;
  }
  return `// Frontier sketch for: ${truncate(prompt, 88)}
// Anchored on: ${memory?.title ?? "no strong memory hit"}
// Check blast radius in src/graph before landing.`;
}

function step(now: Date, offsetMs: number, label: string, detail: string) {
  return {
    at: new Date(now.getTime() + offsetMs).toISOString(),
    label,
    detail,
  };
}

function zeroUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

function truncate(value: string, max: number): string {
  const line = value.trim().replace(/\s+/g, " ");
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
