import { describe, expect, test } from "bun:test"
import type { ListenerRunnerStatus } from "@grist-ai/logic"
import { formatCycleResult, formatListenerStatus, listenerStatusJson } from "./shared"

function status(overrides?: Partial<ListenerRunnerStatus>): ListenerRunnerStatus {
  return {
    enabled: true,
    machine: "macbook",
    path: "/repo/.grist/listener-runner.json",
    ...overrides,
  }
}

describe("listener status rendering", () => {
  test("off state names the machine and points at the opt-in command", () => {
    const text = formatListenerStatus(status({ enabled: false }), "/repo")
    expect(text).toContain("off for /repo on this machine (macbook)")
    expect(text).toContain("grist listener enable")
  })

  test("on state reports the last run and error without credentials", () => {
    const text = formatListenerStatus(
      status({ lastRunAt: 1_700_000_000_000, lastError: "network down" }),
      "/repo",
    )
    expect(text).toContain("on for /repo on this machine (macbook)")
    expect(text).toContain("Last run: 2023-11-14T22:13:20.000Z")
    expect(text).toContain("Last error: network down")
    expect(listenerStatusJson(status(), "/repo")).toEqual({
      enabled: true,
      machine: "macbook",
      directory: "/repo",
      state_path: "/repo/.grist/listener-runner.json",
    })
  })
})

describe("listener cycle result rendering", () => {
  test("completed shows spend, session, and the over-cap flag", () => {
    expect(
      formatCycleResult({
        status: "completed",
        requestId: "glr_1",
        sessionId: "ses_1",
        spendUsd: 0.25,
        outcome: "succeeded",
        overRunCap: false,
      }),
    ).toBe("Request glr_1 succeeded: spend $0.2500 · session ses_1")
    expect(
      formatCycleResult({
        status: "completed",
        requestId: "glr_1",
        spendUsd: 2.5,
        outcome: "succeeded",
        overRunCap: true,
      }),
    ).toContain("over the listener's per-run cap")
  })

  test("refused names the mechanical reason", () => {
    expect(
      formatCycleResult({ status: "refused", requestId: "glr_2", reason: "max_runs_per_day" }),
    ).toContain("refused at claim: max_runs_per_day")
  })
})
