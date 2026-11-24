import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { InviteConfig } from "./invite-config.js"
import {
  isListenerRunnerEnabled,
  loadListenerRunnerState,
  parseGitHubRepo,
  renderListenerPrompt,
  runListenerCycle,
  setListenerRunnerEnabled,
  type ListenerExecRun,
  type ListenerRunRequestWire,
  type ListenerRunnerDeps,
} from "./listener-runner.js"

const CONFIG: InviteConfig = {
  code: "invite-code-1",
  gatewayUrl: "http://gateway.test",
  kind: "invite",
}
const MACHINE = "test-machine"

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "grist-listener-runner-"))
}

function baseDeps(overrides?: Partial<ListenerRunnerDeps>): ListenerRunnerDeps {
  return {
    hostname: () => MACHINE,
    loadConfig: () => CONFIG,
    gitRemote: () => "git@github.com:acme/widgets.git",
    now: () => 1_700_000_000_000,
    ...overrides,
  }
}

function request(overrides?: Partial<ListenerRunRequestWire>): ListenerRunRequestWire {
  return {
    id: "glr_1",
    listener_id: "lis_1",
    listener_name: "ci-failure",
    creator_user_id: "gu_creator",
    source: "github",
    delivery_id: "delivery-1",
    event_kind: "ci_failure",
    event: {
      kind: "ci_failure",
      repo: "acme/widgets",
      workflow: "CI",
      branch: "main",
      conclusion: "failure",
      url: "https://github.com/acme/widgets/actions/runs/1",
    },
    target: { prompt_template: "Fix the failing {{workflow}} run on {{branch}} in {{repo}}." },
    envelope: { max_runs_per_day: 10, max_spend_per_day_usd: 10, max_spend_per_run_usd: 2 },
    state: "queued",
    spend_usd: null,
    created_at: 1_700_000_000_000,
    expires_at: 1_700_000_000_000 + 72 * 3_600_000,
    completed_at: null,
    ...overrides,
  }
}

/**
 * In-memory stub of the gateway's listener runner endpoints (S-LIS1/2
 * wire shapes). Records calls so cycle tests can assert the exact
 * claim → execute → complete sequence.
 */
function stubGateway(options?: {
  queued?: ListenerRunRequestWire[]
  claim?: (id: string) => Record<string, unknown>
  usage?: number[]
}) {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  let usageReads = 0
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    calls.push({ path: url, body })
    if (url.endsWith("/v1/listeners/requests/list")) {
      return Response.json({ requests: options?.queued ?? [] })
    }
    if (url.endsWith("/v1/listeners/requests/claim")) {
      const outcome = options?.claim?.(String(body.request_id)) ?? {
        claimed: true,
        request: (options?.queued ?? [])[0],
      }
      return Response.json(outcome)
    }
    if (url.endsWith("/v1/listeners/requests/complete")) {
      return Response.json({ completed: true, over_run_cap: false })
    }
    if (url.endsWith("/v1/usage")) {
      const values = options?.usage ?? [10, 10.25]
      const value = values[Math.min(usageReads, values.length - 1)] ?? 0
      usageReads += 1
      return Response.json({ spent_usd: value, cap_usd: null, remaining_usd: null })
    }
    return new Response("not found", { status: 404 })
  }
  return { calls, fetchStub: fetchStub as typeof fetch }
}

const okExec: ListenerExecRun = async () => ({ sessionId: "ses_1", ok: true })

describe("listener runner opt-in state (D14: per repo AND per machine)", () => {
  test("enable records only this machine; another machine stays disabled", () => {
    const cwd = tempRepo()
    const state = setListenerRunnerEnabled(cwd, true, baseDeps())
    expect(isListenerRunnerEnabled(state, MACHINE)).toBe(true)
    expect(isListenerRunnerEnabled(state, "other-machine")).toBe(false)
    const reloaded = loadListenerRunnerState(cwd, baseDeps())
    expect(isListenerRunnerEnabled(reloaded, MACHINE)).toBe(true)
    expect(fs.existsSync(path.join(cwd, ".grist", "listener-runner.json"))).toBe(true)
  })

  test("disable removes only this machine's entry", () => {
    const cwd = tempRepo()
    setListenerRunnerEnabled(cwd, true, baseDeps())
    setListenerRunnerEnabled(cwd, true, baseDeps({ hostname: () => "second" }))
    const state = setListenerRunnerEnabled(cwd, false, baseDeps())
    expect(isListenerRunnerEnabled(state, MACHINE)).toBe(false)
    expect(isListenerRunnerEnabled(state, "second")).toBe(true)
  })

  test("a missing or corrupt state file reads as disabled", () => {
    const cwd = tempRepo()
    expect(isListenerRunnerEnabled(loadListenerRunnerState(cwd, baseDeps()), MACHINE)).toBe(false)
    fs.mkdirSync(path.join(cwd, ".grist"), { recursive: true })
    fs.writeFileSync(path.join(cwd, ".grist", "listener-runner.json"), "{not json")
    expect(isListenerRunnerEnabled(loadListenerRunnerState(cwd, baseDeps()), MACHINE)).toBe(false)
  })
})

describe("parseGitHubRepo", () => {
  test("parses ssh, scp-like, and https remotes", () => {
    expect(parseGitHubRepo("git@github.com:acme/widgets.git")).toBe("acme/widgets")
    expect(parseGitHubRepo("ssh://git@github.com/acme/widgets.git")).toBe("acme/widgets")
    expect(parseGitHubRepo("https://github.com/acme/widgets.git")).toBe("acme/widgets")
    expect(parseGitHubRepo("https://github.com/acme/widgets/")).toBe("acme/widgets")
  })

  test("rejects non-repo remotes", () => {
    expect(parseGitHubRepo("")).toBeUndefined()
    expect(parseGitHubRepo("https://github.com/acme")).toBeUndefined()
    expect(parseGitHubRepo("/local/path/repo")).toBeUndefined()
  })
})

describe("renderListenerPrompt", () => {
  test("renders the target template with event facts only", () => {
    expect(renderListenerPrompt(request())).toBe("Fix the failing CI run on main in acme/widgets.")
  })

  test("builds a facts-only prompt without a template", () => {
    const prompt = renderListenerPrompt(request({ target: {} }))
    expect(prompt).toContain("ci_failure")
    expect(prompt).toContain("acme/widgets")
    expect(prompt).toContain("Workflow: CI.")
    expect(prompt).toContain("verify the fix")
  })
})

describe("runListenerCycle", () => {
  test("does nothing when this machine has not opted in", async () => {
    const cwd = tempRepo()
    const stub = stubGateway({ queued: [request()] })
    const result = await runListenerCycle(cwd, {
      ...baseDeps({ fetch: stub.fetchStub }),
      execRun: okExec,
    })
    expect(result).toEqual({ status: "disabled" })
    expect(stub.calls).toHaveLength(0)
  })

  test("skips requests for other repos — they stay queued for their own runners", async () => {
    const cwd = tempRepo()
    setListenerRunnerEnabled(cwd, true, baseDeps())
    const stub = stubGateway({
      queued: [request({ event: { kind: "ci_failure", repo: "other/repo" } })],
    })
    const result = await runListenerCycle(cwd, {
      ...baseDeps({ fetch: stub.fetchStub }),
      execRun: okExec,
    })
    expect(result).toEqual({ status: "idle" })
    expect(stub.calls.some((call) => call.path.endsWith("/claim"))).toBe(false)
  })

  test("happy path: claim → execute → complete with the usage delta as spend", async () => {
    const cwd = tempRepo()
    setListenerRunnerEnabled(cwd, true, baseDeps())
    const queued = request()
    const stub = stubGateway({ queued: [queued], usage: [10, 10.25] })
    const executed: Parameters<ListenerExecRun>[0][] = []
    const result = await runListenerCycle(cwd, {
      ...baseDeps({ fetch: stub.fetchStub }),
      execRun: async (input) => {
        executed.push(input)
        return { sessionId: "ses_1", ok: true }
      },
    })
    expect(result).toEqual({
      status: "completed",
      requestId: "glr_1",
      sessionId: "ses_1",
      spendUsd: 0.25,
      outcome: "succeeded",
      overRunCap: false,
    })
    expect(executed).toEqual([
      {
        directory: cwd,
        prompt: "Fix the failing CI run on main in acme/widgets.",
      },
    ])
    const completeCall = stub.calls.find((call) => call.path.endsWith("/complete"))
    expect(completeCall?.body).toEqual({
      request_id: "glr_1",
      spend_usd: 0.25,
      outcome: "succeeded",
      session_id: "ses_1",
    })
    const state = loadListenerRunnerState(cwd, baseDeps())
    expect(state.last_run_at).toBe(1_700_000_000_000)
  })

  test("a gateway refusal at claim is surfaced, and nothing executes", async () => {
    const cwd = tempRepo()
    setListenerRunnerEnabled(cwd, true, baseDeps())
    const queued = request()
    const stub = stubGateway({
      queued: [queued],
      claim: () => ({ claimed: false, refused: true, reason: "max_runs_per_day", request: queued }),
    })
    let executions = 0
    const result = await runListenerCycle(cwd, {
      ...baseDeps({ fetch: stub.fetchStub }),
      execRun: async () => {
        executions += 1
        return { ok: true }
      },
    })
    expect(result).toEqual({ status: "refused", requestId: "glr_1", reason: "max_runs_per_day" })
    expect(executions).toBe(0)
    expect(stub.calls.some((call) => call.path.endsWith("/complete"))).toBe(false)
  })

  test("a failed execution is reported as a failed completion, not dropped", async () => {
    const cwd = tempRepo()
    setListenerRunnerEnabled(cwd, true, baseDeps())
    const stub = stubGateway({ queued: [request()], usage: [3, 3.1] })
    const result = await runListenerCycle(cwd, {
      ...baseDeps({ fetch: stub.fetchStub }),
      execRun: async () => ({ ok: false, error: "tests still red" }),
    })
    expect(result.status).toBe("completed")
    if (result.status === "completed") expect(result.outcome).toBe("failed")
    const completeCall = stub.calls.find((call) => call.path.endsWith("/complete"))
    expect(completeCall?.body).toMatchObject({ outcome: "failed", error: "tests still red" })
  })

  test("respects the request's environment and conversation targets", async () => {
    const cwd = tempRepo()
    setListenerRunnerEnabled(cwd, true, baseDeps())
    const queued = request({
      target: { environment: "sandbox", conversation: "conv_1", prompt_template: "Go." },
    })
    const stub = stubGateway({ queued: [queued] })
    const executed: Parameters<ListenerExecRun>[0][] = []
    await runListenerCycle(cwd, {
      ...baseDeps({ fetch: stub.fetchStub }),
      execRun: async (input) => {
        executed.push(input)
        return { ok: true }
      },
    })
    expect(executed[0]).toMatchObject({ environment: "sandbox", conversation: "conv_1" })
  })
})
