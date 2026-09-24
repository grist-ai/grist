import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { composeRung, normalizeTaskText, routeTask, scoreTask, shadowScores } from "./jev-gate"
import { GatewayHttpError } from "./invite/client"

class MockGatewayHttpError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(body)
    this.status = status
    this.body = body
  }
}

type GatewayRoute = {
  rung: "cheapest" | "medium" | "frontier"
  model: { provider_id: string; model_id: string }
  difficulty: number
  sensitivity: number
  underspecified: number
  reasons: string[]
  mechanisms: {
    observation_pack: boolean
    observation_pack_compressor?: boolean
    action_fusion: boolean
  }
  provider?: "jev" | "shadow"
  mode?: "normal" | "capped" | "cheapest"
}

let fetchGateRouteImpl: (input: { text: string; sessionID?: string }) => Promise<GatewayRoute>

mock.module("./invite/client", () => ({
  GatewayHttpError: MockGatewayHttpError,
  fetchGateRoute: (input: { text: string; sessionID?: string }) => fetchGateRouteImpl(input),
}))

describe("composeRung", () => {
  test("routes trivial low-sensitivity work to cheapest", () => {
    const { rung } = composeRung({ difficulty: 0.1, sensitivity: 0.1, underspecified: 0.1 })
    expect(rung).toBe("cheapest")
  })

  test("underspecified stays on cheapest (no ask_human)", () => {
    const { rung, reasons } = composeRung({ difficulty: 0.9, sensitivity: 0.1, underspecified: 0.9 })
    expect(rung).toBe("cheapest")
    expect(reasons).toContain("underspecified_cheapest")
  })

  test("sensitivity caps frontier down to cheapest", () => {
    const { rung, reasons } = composeRung({ difficulty: 0.9, sensitivity: 0.9, underspecified: 0.1 })
    expect(rung).toBe("cheapest")
    expect(reasons.some((r) => r.includes("sensitivity"))).toBe(true)
  })

  test("medium difficulty without sensitivity cap", () => {
    const { rung } = composeRung({ difficulty: 0.5, sensitivity: 0.1, underspecified: 0.1 })
    expect(rung).toBe("medium")
  })
})

describe("shadowScores", () => {
  test("flags Fix it. as underspecified", () => {
    const s = shadowScores("Fix it.")
    expect(s.underspecified).toBeGreaterThan(0.7)
  })

  test("scoped rename stays easy", () => {
    const s = shadowScores("Rename unused helper in src/graph/map.ts and update call sites.")
    expect(s.difficulty).toBeLessThan(0.4)
    expect(s.underspecified).toBeLessThan(0.5)
  })

  test("production redesign is hard and sensitive", () => {
    const s = shadowScores(
      "We're seeing duplicate charges in payouts — redesign the ledger to be idempotent and migrate production.",
    )
    expect(s.difficulty).toBeGreaterThan(0.7)
    expect(s.sensitivity).toBeGreaterThan(0.4)
  })
})

describe("verbosity normalization", () => {
  const concise = "Change the login button label from 'Log in' to 'Sign in' in src/ui/LoginButton.tsx."
  const verbose = [
    "Change the login button label from 'Log in' to 'Sign in' in src/ui/LoginButton.tsx. " +
      "This is a small, well-scoped wording update on one component. ".repeat(12).trim(),
    "Background: the design team wants the wording aligned with the new brand guide. " +
      "The button already exists, the file path is known, and no behavior changes. " +
      "There are snapshots covering this component, so updating the label is the whole job. ".repeat(
        4,
      ),
    "Acceptance criteria: the button renders 'Sign in', existing snapshots are refreshed, " +
      "and no other copy on the page changes. Nothing about routing, state, or styling moves.",
  ].join("\n\n")

  test("normalizeTaskText keeps the first paragraph and caps at 500 chars", () => {
    const essence = normalizeTaskText(verbose)
    expect(essence.length).toBeLessThanOrEqual(500)
    expect(essence.startsWith("Change the login button label")).toBe(true)
    expect(essence).not.toContain("Acceptance criteria")
    expect(normalizeTaskText(concise)).toBe(concise)
  })

  test("verbose and concise versions of the same task score within epsilon and land the same rung", async () => {
    const conciseResult = await scoreTask(concise, "")
    const verboseResult = await scoreTask(verbose, "")
    expect(Math.abs(conciseResult.scores.difficulty - verboseResult.scores.difficulty)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(conciseResult.scores.underspecified - verboseResult.scores.underspecified)).toBeLessThanOrEqual(0.05)
    expect(composeRung(conciseResult.scores).rung).toBe(composeRung(verboseResult.scores).rung)
  })
})

describe("routeTask", () => {
  const ENV_KEYS = [
    "GRIST_API_KEY",
    "GRIST_INVITE",
    "GRIST_GATEWAY_URL",
    "GRIST_CONFIG_PATH",
    "GRIST_GATE",
    "GRIST_MODE",
    "GRIST_MECH",
    "GRIST_BURNIN",
    "GRIST_TH_DIFF_MEDIUM",
    "GRIST_TH_DIFF_FRONTIER",
    "GRIST_TH_UNDER_CHEAPEST",
    "GRIST_TH_SENS_CHEAPEST",
    "GRIST_TH_SENS_MEDIUM",
    "TYPESAFE_API_KEY",
  ]
  const API_KEY = `grist_sk_${"a".repeat(64)}`
  const current = { providerID: "openrouter", modelID: "openai/gpt-4.1-nano" }
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
    ENV_KEYS.forEach((key) => delete process.env[key])
    process.env.GRIST_CONFIG_PATH = "/tmp/opencode/grist-test-missing-config.json"
    process.env.GRIST_BURNIN = "off"
    fetchGateRouteImpl = () => Promise.reject(new Error("fetchGateRoute not stubbed"))
  })

  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      const value = saved[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  })

  test("pinned input passes through without touching the gateway", async () => {
    const decision = await routeTask({ text: "What is 7 times 8?", current, pinned: true })
    expect(decision.rung).toBe("cheapest")
    expect(decision.model).toEqual(current)
    expect(decision.provider).toBe("shadow")
    expect(decision.reasons).toEqual(["passthrough"])
    expect(decision.difficulty).toBe(0)
    expect(decision.sensitivity).toBe(0)
    expect(decision.underspecified).toBe(0)
  })

  test("unpinned with an invite routes via the gateway", async () => {
    process.env.GRIST_API_KEY = API_KEY
    const calls: { text: string; sessionID?: string }[] = []
    fetchGateRouteImpl = (input) => {
      calls.push(input)
      return Promise.resolve({
        rung: "medium",
        model: { provider_id: "openrouter", model_id: "anthropic/claude-sonnet-4.5" },
        difficulty: 0.5,
        sensitivity: 0.1,
        underspecified: 0.1,
        reasons: ["gateway_medium"],
        mechanisms: { observation_pack: true, action_fusion: true },
        provider: "jev",
      })
    }
    const decision = await routeTask({ text: "What is 7 times 8?", current })
    expect(calls).toEqual([{ text: "What is 7 times 8?" }])
    expect(decision.rung).toBe("medium")
    expect(decision.model).toEqual({ providerID: "openrouter", modelID: "anthropic/claude-sonnet-4.5" })
    expect(decision.provider).toBe("jev")
    expect(decision.mode).toBe("normal")
    expect(decision.reasons).toEqual(["gateway_medium"])
    expect(decision.mechanisms.resolved).toBe("efficiency")
    expect(decision.mechanisms.observationPack).toBe(true)
    expect(decision.mechanisms.actionFusion).toBe(true)
    expect(decision.mechanisms.reasons).toEqual(["gateway"])
  })

  test("non-402 gateway failure falls back to the local shadow gate", async () => {
    process.env.GRIST_API_KEY = API_KEY
    fetchGateRouteImpl = () => Promise.reject(new MockGatewayHttpError(500, "boom"))
    const decision = await routeTask({ text: "Summarize the routing logic in src/grist/jev-gate.ts", current })
    expect(decision.provider).toBe("shadow")
    expect(decision.rung).toBe("cheapest")
    expect(decision.reasons).toContain("difficulty_cheapest")
  })

  test("402 from the gateway rethrows instead of falling back", async () => {
    process.env.GRIST_API_KEY = API_KEY
    fetchGateRouteImpl = () => Promise.reject(new MockGatewayHttpError(402, "cap reached"))
    const error: unknown = await routeTask({ text: "What is 7 times 8?", current }).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(GatewayHttpError)
    expect(error).toMatchObject({ status: 402 })
  })

  test("without an invite it uses the local shadow gate and never calls the gateway", async () => {
    let called = false
    fetchGateRouteImpl = () => {
      called = true
      return Promise.reject(new Error("fetchGateRoute must not be called"))
    }
    const decision = await routeTask({ text: "Summarize the routing logic in src/grist/jev-gate.ts", current })
    expect(called).toBe(false)
    expect(decision.provider).toBe("shadow")
    expect(decision.rung).toBe("cheapest")
  })
})
