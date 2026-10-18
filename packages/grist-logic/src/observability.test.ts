import { describe, expect, test } from "bun:test"
import { outcomeForExecution, taskUsageFromStepEnded } from "./observability.js"

describe("taskUsageFromStepEnded", () => {
  test("maps a well-formed step.ended payload", () => {
    const usage = taskUsageFromStepEnded(
      {
        sessionID: "ses_1",
        assistantMessageID: "msg_1",
        cost: 0.0123,
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 2 } },
      },
      { providerID: "grist", modelID: "cheapest" },
    )
    expect(usage).toEqual({
      sessionID: "ses_1",
      messageID: "msg_1",
      providerID: "grist",
      modelID: "cheapest",
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 2 } },
      costUsd: 0.0123,
    })
  })

  test("defaults missing reasoning/cache to zero", () => {
    const usage = taskUsageFromStepEnded(
      { sessionID: "s", assistantMessageID: "m", cost: 0, tokens: { input: 1, output: 2 } },
      { providerID: "grist", modelID: "medium" },
    )
    expect(usage?.tokens.reasoning).toBe(0)
    expect(usage?.tokens.cache).toEqual({ read: 0, write: 0 })
  })

  test("rejects unusable payloads", () => {
    const model = { providerID: "grist", modelID: "cheapest" }
    expect(taskUsageFromStepEnded({}, model)).toBeUndefined()
    expect(
      taskUsageFromStepEnded({ sessionID: "s", assistantMessageID: "m", tokens: { input: 1, output: 1 } }, model),
    ).toBeUndefined()
    expect(
      taskUsageFromStepEnded({ sessionID: "s", assistantMessageID: "m", cost: 0.1 }, model),
    ).toBeUndefined()
  })
})

describe("outcomeForExecution", () => {
  test("maps lifecycle events", () => {
    expect(outcomeForExecution("session.execution.succeeded")).toEqual({ outcome: "success" })
    expect(outcomeForExecution("session.execution.failed")).toEqual({ outcome: "fail" })
    expect(outcomeForExecution("session.execution.interrupted")).toEqual({ outcome: "unknown" })
    expect(outcomeForExecution("session.step.ended")).toBeUndefined()
  })
})
