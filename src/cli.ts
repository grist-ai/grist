#!/usr/bin/env npx tsx

import { spawn, spawnSync } from "node:child_process";
import { DEFAULT_GATE_SETTINGS, runGate } from "@/lib/gate";
import { retrieveMemory } from "@/lib/memory/retrieve";
import { formatMs, formatPercent, routeLabel } from "@/lib/format";
import { assertNever } from "@/lib/never";
import type { GateDecision, Route } from "@/lib/types";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  if (args[0] === "floor" || args.includes("--floor")) {
    await startLocalFloor();
    return;
  }

  const prompt = args.join(" ").trim();
  const decision = await runGate(prompt, DEFAULT_GATE_SETTINGS);
  printGate(decision);

  const retrieved = retrieveMemory(prompt);
  if (retrieved.length > 0) {
    console.log("\nMemory");
    for (const snippet of retrieved.slice(0, 3)) {
      console.log(`  - ${snippet.title}${snippet.path ? ` (${snippet.path})` : ""}`);
    }
  }

  await takeRoute(decision.route, prompt);
}

function printUsage(): void {
  console.log(`Grist — local mill. Run this on your machine, not a cloud agent.

Usage:
  npm run mill -- "<task>"
  npm run mill -- floor

Local routes hand off to OpenCode on this box:
  npm i -g opencode-ai
  # or: curl -fsSL https://opencode.ai/install | bash

Optional live Jev:
  TYPESAFE_API_KEY=... npm run mill -- "<task>"
`);
}

function printGate(decision: GateDecision): void {
  console.log(`Gate  ${routeLabel(decision.route)}  ·  ${decision.provider}  ·  ${formatMs(decision.latencyMs)}`);
  console.log(`  Score   local confidence  ${formatPercent(decision.confidence)}`);
  console.log(`  Noul    high stakes       ${formatPercent(decision.highStakes)}`);
  console.log(`  Noul    underspecified    ${formatPercent(decision.underspecified)}`);
  console.log(`  Choice  ${decision.choice.replaceAll("_", " ")} (${formatPercent(decision.choiceConfidence)})`);
  console.log(`  Reason  ${decision.reasons.join(", ")}`);
}

async function takeRoute(route: Route, prompt: string): Promise<void> {
  switch (route) {
    case "ask_human":
      console.log("\nAsk a human. The mill will not invent the goal, files, or constraints.");
      process.exitCode = 2;
      return;
    case "frontier_escalation":
      console.log("\nFrontier. This task does not run on the local box. Wire a metered API later; Grist will not silently spend it.");
      process.exitCode = 3;
      return;
    case "local_model": {
      const binary = findOpenCode();
      if (!binary) {
        console.log(`
OpenCode is not on PATH. Install it on this machine, then re-run:

  npm i -g opencode-ai
  # or: curl -fsSL https://opencode.ai/install | bash

Grist is the gate. OpenCode is the local agent loop. This process will not start a browser in a cloud VM.
`);
        process.exitCode = 4;
        return;
      }
      console.log(`\nHanding off to ${binary} run …\n`);
      const code = await spawnInherit(binary, ["run", prompt]);
      process.exitCode = code;
      return;
    }
    default:
      assertNever(route);
  }
}

function findOpenCode(): string | null {
  const fromEnv = process.env.GRIST_OPENCODE?.trim();
  if (fromEnv) return fromEnv;
  const found = spawnSync("sh", ["-c", "command -v opencode"], {
    encoding: "utf8",
  });
  const path = found.stdout.trim();
  return found.status === 0 && path ? path : null;
}

function spawnInherit(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function startLocalFloor(): Promise<void> {
  console.log("Starting the operator floor on 127.0.0.1:4327 — on this machine.");
  const code = await spawnInherit("npm", ["run", "floor"]);
  process.exitCode = code;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
