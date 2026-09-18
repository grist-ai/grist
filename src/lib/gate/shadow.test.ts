import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeRoute, DEFAULT_GATE_SETTINGS } from "./compose";
import { shadowAnswers } from "./shadow";

describe("shadowAnswers", () => {
  it("routes a scoped rename to the local model", () => {
    const prompt =
      "Rename the unused `fetchLegacyMap` helper in src/graph/map.ts and update call sites.";
    const decision = composeRoute(shadowAnswers(prompt), DEFAULT_GATE_SETTINGS);
    assert.equal(decision.route, "local_model");
  });

  it("escalates a production ledger redesign", () => {
    const prompt =
      "We're seeing duplicate charges in payouts — redesign the ledger to be idempotent and migrate production.";
    const decision = composeRoute(shadowAnswers(prompt), DEFAULT_GATE_SETTINGS);
    assert.equal(decision.route, "frontier_escalation");
  });

  it("asks a human when the task is just 'Fix it.'", () => {
    const decision = composeRoute(shadowAnswers("Fix it."), DEFAULT_GATE_SETTINGS);
    assert.equal(decision.route, "ask_human");
  });

  it("keeps a scoped regression test on the local model", () => {
    const prompt =
      "Add a regression test in src/ownership/miner_test.py for skipping bot commits and merges.";
    const decision = composeRoute(shadowAnswers(prompt), DEFAULT_GATE_SETTINGS);
    assert.equal(decision.route, "local_model");
  });
});
