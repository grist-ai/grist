import { DEFAULT_GATE_SETTINGS } from "@/lib/gate/compose";
import { runGate } from "@/lib/gate";
import { retrieveMemory } from "@/lib/memory/retrieve";
import {
  counterfactualFrontierCost,
  simulateAgent,
} from "@/lib/agent/simulate";
import { titleFromPrompt } from "@/lib/format";
import { createId } from "@/lib/ids";
import { seedTasks } from "@/lib/seed";
import { round4 } from "@/lib/gate/primitives";
import type {
  Appliance,
  GateSettings,
  Metrics,
  Route,
  Task,
} from "@/lib/types";

const PILOT_APPLIANCE: Appliance = {
  name: "Grist Pilot 01",
  tier: "pilot",
  hardware: "Mac mini M4, 24GB unified memory (or this Linux box in shadow)",
  memoryGb: 24,
  slots: 4,
  model: "Ternary Bonsai 2 27B",
  modelSizeGb: 5.9,
  inference: "llama.cpp parallel slots",
  connected: false,
};

type GlobalGrist = {
  store: GristStore;
};

const globalForStore = globalThis as typeof globalThis & {
  __grist?: GlobalGrist;
};

export class GristStore {
  private tasks = new Map<string, Task>();
  settings: GateSettings = { ...DEFAULT_GATE_SETTINGS };
  appliance: Appliance = { ...PILOT_APPLIANCE };

  constructor() {
    for (const task of seedTasks()) {
      this.tasks.set(task.id, task);
    }
  }

  listTasks(): Task[] {
    return [...this.tasks.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  updateSettings(patch: Partial<GateSettings>): GateSettings {
    this.settings = { ...this.settings, ...patch };
    return this.settings;
  }

  async submitTask(prompt: string): Promise<Task> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      throw new Error("Task prompt is empty.");
    }

    const id = createId("tsk");
    const createdAt = new Date().toISOString();
    const stub: Task = {
      id,
      title: titleFromPrompt(trimmed),
      prompt: trimmed,
      status: "gating",
      route: null,
      gate: null,
      retrieved: [],
      result: null,
      tokens: {
        gate: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        local: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        frontier: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      },
      costUsd: 0,
      counterfactualFrontierUsd: counterfactualFrontierCost(trimmed),
      createdAt,
      completedAt: null,
      seed: false,
      outcome: null,
    };
    this.tasks.set(id, stub);

    const retrieved = retrieveMemory(trimmed);
    const gate = await runGate(trimmed, this.settings);
    stub.gate = gate;
    stub.route = gate.route;
    stub.retrieved = retrieved;
    stub.tokens.gate = gate.usage;

    if (gate.route === "ask_human") {
      stub.status = "needs_human";
      const simulated = simulateAgent({
        prompt: trimmed,
        route: "ask_human",
        retrieved,
      });
      stub.result = simulated.result;
      this.tasks.set(id, stub);
      return stub;
    }

    return this.execute(stub, gate.route);
  }

  async resolveHuman(id: string, action: "local" | "frontier" | "dismiss"): Promise<Task> {
    const task = this.tasks.get(id);
    if (!task) throw new Error("Unknown task");
    if (task.status !== "needs_human") {
      throw new Error("Task is not waiting on a human");
    }
    if (action === "dismiss") {
      task.status = "dismissed";
      task.completedAt = new Date().toISOString();
      this.tasks.set(id, task);
      return task;
    }
    const route: Route = action === "local" ? "local_model" : "frontier_escalation";
    task.route = route;
    if (task.gate) {
      task.gate = {
        ...task.gate,
        route,
        reasons: [...task.gate.reasons, "human_override"],
      };
    }
    return this.execute(task, route);
  }

  metrics(): Metrics {
    const tasks = this.listTasks().filter((t) => t.status !== "dismissed");
    const routed = tasks.filter((t) => t.route);
    const localCount = routed.filter((t) => t.route === "local_model").length;
    const frontierCount = routed.filter((t) => t.route === "frontier_escalation").length;
    const humanCount = routed.filter((t) => t.route === "ask_human").length;
    const spendUsd = round4(tasks.reduce((acc, t) => acc + t.costUsd, 0));
    const counterfactualFrontierUsd = round4(
      tasks.reduce((acc, t) => acc + t.counterfactualFrontierUsd, 0),
    );
    const latencies = tasks
      .map((t) => t.gate?.latencyMs)
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => a - b);
    const gateLatencyMsP50 =
      latencies.length === 0 ? null : latencies[Math.floor(latencies.length / 2)] ?? null;

    return {
      taskCount: tasks.length,
      localCount,
      frontierCount,
      humanCount,
      localShare: routed.length === 0 ? null : localCount / routed.length,
      spendUsd,
      counterfactualFrontierUsd,
      savedUsd: round4(Math.max(0, counterfactualFrontierUsd - spendUsd)),
      gateLatencyMsP50,
      localTokens: sumTokens(tasks, "local"),
      frontierTokens: sumTokens(tasks, "frontier"),
      gateTokens: sumTokens(tasks, "gate"),
    };
  }

  private execute(task: Task, route: Route): Task {
    task.status = "running";
    const simulated = simulateAgent({
      prompt: task.prompt,
      route,
      retrieved: task.retrieved,
    });
    task.result = simulated.result;
    if (route === "local_model") {
      task.tokens.local = simulated.usage;
      task.outcome = "local_success";
    } else {
      task.tokens.frontier = simulated.usage;
      task.outcome = "needed_escalation";
    }
    task.costUsd = round4(
      task.tokens.gate.costUsd +
        task.tokens.local.costUsd +
        task.tokens.frontier.costUsd,
    );
    task.status = "succeeded";
    task.completedAt = new Date().toISOString();
    this.tasks.set(task.id, task);
    return task;
  }
}

function sumTokens(tasks: Task[], lane: "gate" | "local" | "frontier"): number {
  return tasks.reduce(
    (acc, t) => acc + t.tokens[lane].inputTokens + t.tokens[lane].outputTokens,
    0,
  );
}

export function getStore(): GristStore {
  if (!globalForStore.__grist) {
    globalForStore.__grist = { store: new GristStore() };
  }
  return globalForStore.__grist.store;
}
