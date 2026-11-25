import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { InviteConfig } from "./invite-config.js"
import { decideInboxItem, type InboxItemWire } from "./inbox.js"
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
        requestId: "glr_1",
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

describe("approvals inbox wiring (next-block spec §7, S-INBOX1)", () => {
  function inboxItem(overrides?: Partial<InboxItemWire>): InboxItemWire {
    return {
      id: "gi_1",
      team_id: "team_1",
      source: "ask_human",
      boundary: "write-outside-environment",
      state: "approved",
      question: "May the run read the file outside its environment?",
      detail: {},
      creator_user_id: "gu_creator",
      request_id: "glr_1",
      session_id: "ses_9",
      answer: "Yes — read-only is fine.",
      decided_by_user_id: "gu_creator",
      created_at: 1_700_000_000_000,
      expires_at: 1_700_000_000_000 + 72 * 3_600_000,
      decided_at: 1_700_000_100_000,
      ...overrides,
    }
  }

  /** Gateway stub with the inbox endpoints wired in. */
  function inboxGateway(options?: {
    queued?: ListenerRunRequestWire[]
    all?: ListenerRunRequestWire[]
    claim?: (id: string) => Record<string, unknown>
    inbox?: InboxItemWire[]
  }) {
    const calls: { path: string; body: Record<string, unknown> }[] = []
    const fetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      calls.push({ path: url, body })
      if (url.endsWith("/v1/inbox/list")) {
        return Response.json({ items: options?.inbox ?? [] })
      }
      if (url.endsWith("/v1/inbox/items")) {
        return Response.json({ item: inboxItem({ id: "gi_new", state: "pending", answer: null }) })
      }
      if (url.endsWith("/v1/listeners/requests/list")) {
        return Response.json({
          requests: body.state === "queued" ? (options?.queued ?? []) : (options?.all ?? options?.queued ?? []),
        })
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
        return Response.json({ spent_usd: 10, cap_usd: null, remaining_usd: null })
      }
      return new Response("not found", { status: 404 })
    }
    return { calls, fetchStub: fetchStub as typeof fetch }
  }

  test("a claim that parks on an envelope breach surfaces the park and executes nothing", async () => {
    const cwd = tempRepo()
    setListenerRunnerEnabled(cwd, true, baseDeps())
    const queued = request()
    const stub = inboxGateway({
      queued: [queued],
      claim: () => ({
        claimed: false,
        parked: true,
        reason: "max_runs_per_day",
        inbox_item_id: "gi_park1",
        request: { ...queued, state: "awaiting_approval" },
      }),
    })
    let executions = 0
    const result = await runListenerCycle(cwd, {
      ...baseDeps({ fetch: stub.fetchStub }),
      execRun: async () => {
        executions += 1
        return { ok: true }
      },
    })
    expect(result).toEqual({
      status: "parked",
      requestId: "glr_1",
      reason: "max_runs_per_day",
      inboxItemId: "gi_park1",
    })
    expect(executions).toBe(0)
    expect(stub.calls.some((call) => call.path.endsWith("/complete"))).toBe(false)
  })

  test("an escalation posts an ask_human item and completes the request as failed", async () => {
    const cwd = tempRepo()
    setListenerRunnerEnabled(cwd, true, baseDeps())
    const stub = inboxGateway({ queued: [request()] })
    const result = await runListenerCycle(cwd, {
      ...baseDeps({ fetch: stub.fetchStub }),
      execRun: async () => ({
        sessionId: "ses_9",
        ok: false,
        error: "the run stopped",
        escalation: {
          boundary: "write-outside-environment" as const,
          question: "The run stopped on an unanswered permission ask (external_directory).",
        },
      }),
    })
    expect(result).toEqual({
      status: "question_parked",
      requestId: "glr_1",
      itemId: "gi_new",
      sessionId: "ses_9",
    })
    const posted = stub.calls.find((call) => call.path.endsWith("/v1/inbox/items"))
    expect(posted?.body).toMatchObject({
      source: "ask_human",
      boundary: "write-outside-environment",
      request_id: "glr_1",
      session_id: "ses_9",
    })
    const complete = stub.calls.find((call) => call.path.endsWith("/complete"))
    expect(complete?.body).toMatchObject({ outcome: "failed", session_id: "ses_9" })
    expect(String(complete?.body.error)).toContain("parked in the approvals inbox")
  })

  test("an answered item resumes its session with the answer as the prompt — once", async () => {
    const cwd = tempRepo()
    setListenerRunnerEnabled(cwd, true, baseDeps())
    const stub = inboxGateway({
      queued: [],
      all: [request({ state: "completed" })],
      inbox: [inboxItem()],
    })
    const executed: Parameters<ListenerExecRun>[0][] = []
    const deps = {
      ...baseDeps({ fetch: stub.fetchStub }),
      execRun: async (input: Parameters<ListenerExecRun>[0]) => {
        executed.push(input)
        return { sessionId: "ses_9", ok: true }
      },
    }
    const first = await runListenerCycle(cwd, deps)
    expect(first).toEqual({ status: "resumed", itemId: "gi_1", sessionId: "ses_9", ok: true })
    expect(executed).toHaveLength(1)
    expect(executed[0]).toMatchObject({
      prompt: "Yes — read-only is fine.",
      sessionId: "ses_9",
      requestId: "glr_1",
    })
    // The runner remembers the resume: the still-"approved" item is
    // not resumed a second time; the cycle falls through to idle.
    const second = await runListenerCycle(cwd, deps)
    expect(second).toEqual({ status: "idle" })
    expect(executed).toHaveLength(1)
    expect(loadListenerRunnerState(cwd, baseDeps()).resumed_inbox_items).toEqual(["gi_1"])
  })

  test("an answered item for another repo is not resumed here", async () => {
    const cwd = tempRepo()
    setListenerRunnerEnabled(cwd, true, baseDeps())
    const stub = inboxGateway({
      queued: [],
      all: [request({ state: "completed", event: { repo: "other/repo" } })],
      inbox: [inboxItem()],
    })
    let executions = 0
    const result = await runListenerCycle(cwd, {
      ...baseDeps({ fetch: stub.fetchStub }),
      execRun: async () => {
        executions += 1
        return { ok: true }
      },
    })
    expect(result).toEqual({ status: "idle" })
    expect(executions).toBe(0)
  })

  test("the inbox client surfaces the gateway's account-auth refusal on decide", async () => {
    const fetchStub = async (): Promise<Response> =>
      Response.json(
        { error: "inbox decisions require the account holder's own sign-in", reason: "deciding_requires_account_auth" },
        { status: 403 },
      )
    await expect(
      decideInboxItem(CONFIG, { itemId: "gi_1", decision: "approve" }, { fetchFn: fetchStub as unknown as typeof fetch }),
    ).rejects.toThrow("deciding_requires_account_auth")
  })
})
