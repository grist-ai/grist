import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeRoute, DEFAULT_GATE_SETTINGS } from "./compose";
import { toChoiceAnswer, toScoreAnswer } from "./primitives";
import { LOCAL_CONFIDENCE_LEVELS } from "./primitives";
import type { GateAnswers, Route } from "../types";

function answers(partial: {
  confidenceLevel: number;
  highStakes: number;
  underspecified: number;
  choice?: Route;
}): GateAnswers {
  const probabilities = [0, 0, 0, 0, 0];
  probabilities[partial.confidenceLevel] = 1;
  return {
    localConfidence: toScoreAnswer(probabilities, LOCAL_CONFIDENCE_LEVELS),
    highStakes: { type: "noul", noul: partial.highStakes },
    underspecified: { type: "noul", noul: partial.underspecified },
    suggestedRoute: toChoiceAnswer({
      local_model: partial.choice === "local_model" ? 0.8 : 0.1,
      frontier_escalation: partial.choice === "frontier_escalation" ? 0.8 : 0.1,
      ask_human: partial.choice === "ask_human" ? 0.8 : 0.1,
    }),
  };
}

describe("composeRoute", () => {
  it("sends high-confidence low-stakes work to the local model", () => {
    const decision = composeRoute(
      answers({
        confidenceLevel: 4,
        highStakes: 0.1,
        underspecified: 0.08,
        choice: "local_model",
      }),
      DEFAULT_GATE_SETTINGS,
    );
    assert.equal(decision.route, "local_model");
    assert.ok(decision.reasons.includes("confidence_above_threshold"));
  });

  it("escalates when confidence is below the threshold", () => {
    const decision = composeRoute(
      answers({
        confidenceLevel: 1,
        highStakes: 0.1,
        underspecified: 0.1,
        choice: "frontier_escalation",
      }),
      DEFAULT_GATE_SETTINGS,
    );
    assert.equal(decision.route, "frontier_escalation");
    assert.ok(decision.reasons.includes("confidence_below_threshold"));
  });

  it("asks a human when the task is underspecified", () => {
    const decision = composeRoute(
      answers({
        confidenceLevel: 3,
        highStakes: 0.1,
        underspecified: 0.9,
        choice: "ask_human",
      }),
      DEFAULT_GATE_SETTINGS,
    );
    assert.equal(decision.route, "ask_human");
    assert.ok(decision.reasons.includes("underspecified"));
  });

  it("escalates high-stakes work even when local confidence is high", () => {
    const decision = composeRoute(
      answers({
        confidenceLevel: 4,
        highStakes: 0.92,
        underspecified: 0.1,
        choice: "local_model",
      }),
      DEFAULT_GATE_SETTINGS,
    );
    assert.equal(decision.route, "frontier_escalation");
    assert.ok(decision.reasons.includes("high_stakes"));
  });

  it("flips local vs frontier when the calibrated threshold moves", () => {
    const mid = answers({
      confidenceLevel: 3,
      highStakes: 0.1,
      underspecified: 0.08,
      choice: "local_model",
    });
    const low = composeRoute(mid, {
      ...DEFAULT_GATE_SETTINGS,
      confidenceThreshold: 0.5,
    });
    const high = composeRoute(mid, {
      ...DEFAULT_GATE_SETTINGS,
      confidenceThreshold: 0.95,
    });
    assert.equal(low.route, "local_model");
    assert.equal(high.route, "frontier_escalation");
  });
});
