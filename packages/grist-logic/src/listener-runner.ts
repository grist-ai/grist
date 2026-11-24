/**
 * Listener runner (next-block spec §6.3/§6.7, S-LIS2; decisions D14/D16).
 *
 * The harness side of listeners. The gateway queues run requests from
 * signed webhooks (S-LIS1); a runner on a team member's machine claims
 * one, executes it as a real `grist run` in this repo, and reports the
 * outcome + spend back. The gateway never executes (D13).
 *
 * Opt-in is per repo AND per machine (D14), and separate from team
 * memory/object sync opt-in: state lives in
 * `<cwd>/.grist/listener-runner.json` as a set of machine names that
 * have opted in for this repo — enabling on one machine says nothing
 * about another, and a repo without the file never runs listeners.
 *
 * Execution identity (D14): the run executes AS THE LISTENER'S
 * CREATOR. The claim/report calls authenticate with the runner
 * operator's own invite (the only credential the runner holds); the
 * run itself presents that same gateway credential, and the gateway
 * meters the run's spend under the invite the run presents, with team
 * key sharing resolving the upstream provider credential exactly as
 * for an interactive run. No second credential exists.
 *
 * Repo scoping: a runner claims only requests whose event repo
 * matches THIS repo's origin remote. Requests for other repos stay
 * queued for their own runners; if no runner ever claims them they
 * expire by TTL with audit (spec §6.3: events for a repo with no
 * opted-in runner are never executed).
 *
 * Spend measurement: the cycle reads the invite's gateway usage
 * (GET /v1/usage spent_usd) immediately before and after the run and
 * reports the delta as the run's spend. Honest limits: spend from
 * anything else this invite does concurrently would be attributed to
 * the run too, and a run whose completion report never lands is
 * recovered by the gateway's claim lease, not by the runner.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { gatewayAuthHeaders, loadInviteConfig, type InviteConfig } from "./invite-config.js"
import { GatewayHttpError } from "./invite-client.js"

export type ListenerRunnerState = {
  version: 1
  /** Machine name (os.hostname()) → when that machine opted in. */
  machines: Record<string, { enabled_at: number }>
  last_run_at?: number
  last_error?: string
}

export type ListenerRunnerDeps = {
  readFile?: (filePath: string) => string
  writeFile?: (filePath: string, content: string) => void
  mkdir?: (dir: string) => void
  fetch?: typeof fetch
  loadConfig?: () => InviteConfig | undefined
  now?: () => number
  hostname?: () => string
  /** Reads `git remote get-url origin` for the repo; undefined when absent. */
  gitRemote?: (cwd: string) => string | undefined
}

export function listenerRunnerPath(cwd: string): string {
  const override = process.env.GRIST_LISTENER_RUNNER_PATH
  if (override && override.length > 0) return override
  return path.join(cwd, ".grist", "listener-runner.json")
}

export function emptyListenerRunnerState(): ListenerRunnerState {
  return { version: 1, machines: {} }
}

export function loadListenerRunnerState(cwd: string, deps?: ListenerRunnerDeps): ListenerRunnerState {
  try {
    const raw = (deps?.readFile ?? ((p: string) => fs.readFileSync(p, "utf8")))(listenerRunnerPath(cwd))
    const parsed = JSON.parse(raw) as Partial<ListenerRunnerState>
    if (!parsed || typeof parsed !== "object") return emptyListenerRunnerState()
    const machines: ListenerRunnerState["machines"] = {}
    if (parsed.machines && typeof parsed.machines === "object") {
      for (const [name, entry] of Object.entries(parsed.machines)) {
        if (entry && typeof entry === "object" && typeof entry.enabled_at === "number") {
          machines[name] = { enabled_at: entry.enabled_at }
        }
      }
    }
    return {
      version: 1,
      machines,
      ...(typeof parsed.last_run_at === "number" ? { last_run_at: parsed.last_run_at } : {}),
      ...(typeof parsed.last_error === "string" ? { last_error: parsed.last_error } : {}),
    }
  } catch {
    return emptyListenerRunnerState()
  }
}

export function readListenerRunnerStateSync(cwd: string): ListenerRunnerState {
  return loadListenerRunnerState(cwd)
}

function saveListenerRunnerState(cwd: string, state: ListenerRunnerState, deps?: ListenerRunnerDeps): void {
  const filePath = listenerRunnerPath(cwd)
  ;(deps?.mkdir ?? ((dir: string) => fs.mkdirSync(dir, { recursive: true })))(path.dirname(filePath))
  ;(deps?.writeFile ?? ((p: string, content: string) => fs.writeFileSync(p, content)))(
    filePath,
    JSON.stringify(state, null, 2) + "\n",
  )
}

export function runnerMachineName(deps?: ListenerRunnerDeps): string {
  return (deps?.hostname ?? (() => os.hostname()))()
}

/** Per repo AND per machine (D14): both this repo's state file and
 * this machine's entry in it must say yes. */
export function isListenerRunnerEnabled(state: ListenerRunnerState, machine: string): boolean {
  return state.machines[machine] !== undefined
}

export function setListenerRunnerEnabled(
  cwd: string,
  enabled: boolean,
  deps?: ListenerRunnerDeps,
): ListenerRunnerState {
  const state = loadListenerRunnerState(cwd, deps)
  const machine = runnerMachineName(deps)
  if (enabled) state.machines[machine] = { enabled_at: (deps?.now ?? Date.now)() }
  else delete state.machines[machine]
  saveListenerRunnerState(cwd, state, deps)
  return state
}

export type ListenerRunnerStatus = {
  enabled: boolean
  machine: string
  path: string
  lastRunAt?: number
  lastError?: string
}

export function summarizeListenerRunnerState(
  state: ListenerRunnerState,
  cwd: string,
  machine: string,
): ListenerRunnerStatus {
  return {
    enabled: isListenerRunnerEnabled(state, machine),
    machine,
    path: listenerRunnerPath(cwd),
    ...(state.last_run_at !== undefined ? { lastRunAt: state.last_run_at } : {}),
    ...(state.last_error !== undefined ? { lastError: state.last_error } : {}),
  }
}

/**
 * Normalize a git remote URL to `owner/name`. Handles the SSH forms
 * (`git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo`)
 * and HTTPS (`https://github.com/owner/repo.git`). Returns undefined
 * for anything that is not a two-segment path on a host.
 */
export function parseGitHubRepo(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim()
  if (!trimmed) return undefined
  const scpLike = /^[^@\s]+@[^:\s]+:(.+)$/.exec(trimmed)
  const pathPart = scpLike
    ? scpLike[1]
    : (() => {
        try {
          return new URL(trimmed).pathname.replace(/^\/+/, "")
        } catch {
          return undefined
        }
      })()
  if (!pathPart) return undefined
  const segments = pathPart.replace(/\/+$/, "").replace(/\.git$/, "").split("/")
  if (segments.length !== 2 || !segments[0] || !segments[1]) return undefined
  return `${segments[0]}/${segments[1]}`
}

function defaultGitRemote(cwd: string): string | undefined {
  try {
    const out = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return out.trim() || undefined
  } catch {
    return undefined
  }
}

/** This repo's `owner/name` identity from its origin remote. */
export function repoIdentity(cwd: string, deps?: ListenerRunnerDeps): string | undefined {
  const remote = (deps?.gitRemote ?? defaultGitRemote)(cwd)
  return remote ? parseGitHubRepo(remote) : undefined
}

/** The wire shape of a queued run request (gateway http.ts
 * publicListenerRunRequest). `event` carries the normalized event
 * facts only — never the raw payload. */
export type ListenerRunRequestWire = {
  id: string
  listener_id: string
  listener_name: string
  creator_user_id: string | null
  source: string
  delivery_id: string
  event_kind: string
  event: Record<string, unknown>
  target: {
    environment?: string
    conversation?: string
    agent?: string
    prompt_template?: string
  }
  envelope: {
    max_runs_per_day: number
    max_spend_per_day_usd: number
    max_spend_per_run_usd: number
  }
  state: string
  spend_usd: number | null
  created_at: number
  expires_at: number
  completed_at: number | null
}

async function runnerJson<T>(
  config: InviteConfig,
  route: string,
  init: { method: "GET" | "POST"; body?: unknown },
  deps?: ListenerRunnerDeps,
): Promise<T> {
  const doFetch = deps?.fetch ?? fetch
  const res = await doFetch(`${config.gatewayUrl}${route}`, {
    method: init.method,
    headers: { "content-type": "application/json", ...gatewayAuthHeaders(config) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = {}
  }
  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `gateway returned ${res.status}`
    throw new GatewayHttpError(res.status, message)
  }
  return parsed as T
}

export async function listQueuedListenerRequests(
  config: InviteConfig,
  deps?: ListenerRunnerDeps,
): Promise<ListenerRunRequestWire[]> {
  const body = await runnerJson<{ requests: ListenerRunRequestWire[] }>(
    config,
    "/v1/listeners/requests/list",
    { method: "POST", body: { state: "queued", limit: 100 } },
    deps,
  )
  return body.requests ?? []
}

export type ListenerClaimOutcome =
  | { claimed: true; request: ListenerRunRequestWire }
  | { claimed: false; refused: true; reason: string; request: ListenerRunRequestWire }
  | { claimed: false; expired: true; request: ListenerRunRequestWire }

export async function claimListenerRequest(
  config: InviteConfig,
  requestId: string,
  deps?: ListenerRunnerDeps,
): Promise<ListenerClaimOutcome> {
  const body = await runnerJson<{
    claimed: boolean
    refused?: boolean
    expired?: boolean
    reason?: string
    request: ListenerRunRequestWire
  }>(config, "/v1/listeners/requests/claim", { method: "POST", body: { request_id: requestId } }, deps)
  if (body.claimed) return { claimed: true, request: body.request }
  if (body.refused) {
    return { claimed: false, refused: true, reason: body.reason ?? "refused", request: body.request }
  }
  return { claimed: false, expired: true, request: body.request }
}

export async function completeListenerRequest(
  config: InviteConfig,
  input: {
    requestId: string
    spendUsd: number
    outcome: "succeeded" | "failed"
    sessionId?: string
    error?: string
  },
  deps?: ListenerRunnerDeps,
): Promise<{ overRunCap: boolean }> {
  const body = await runnerJson<{ over_run_cap: boolean }>(
    config,
    "/v1/listeners/requests/complete",
    {
      method: "POST",
      body: {
        request_id: input.requestId,
        spend_usd: input.spendUsd,
        outcome: input.outcome,
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        ...(input.error ? { error: input.error } : {}),
      },
    },
    deps,
  )
  return { overRunCap: body.over_run_cap === true }
}

async function inviteSpentUsd(config: InviteConfig, deps?: ListenerRunnerDeps): Promise<number> {
  const body = await runnerJson<{ spent_usd: number }>(config, "/v1/usage", { method: "GET" }, deps)
  return typeof body.spent_usd === "number" ? body.spent_usd : 0
}

/**
 * Render the run prompt from the request's target template + the
 * event facts (spec §6.2: facts only — the payload body never enters
 * the prompt). Placeholders: {{kind}} {{repo}} {{workflow}} {{branch}}
 * {{conclusion}} {{label}} {{labels}} {{url}} {{title}}. Without a
 * template, a plain facts-only prompt is built.
 */
export function renderListenerPrompt(request: ListenerRunRequestWire): string {
  const event = request.event
  const text = (key: string): string => (typeof event[key] === "string" ? (event[key] as string) : "")
  const labels = Array.isArray(event.labels)
    ? event.labels.filter((label): label is string => typeof label === "string")
    : []
  const facts: Record<string, string> = {
    kind: request.event_kind,
    repo: text("repo"),
    workflow: text("workflow"),
    branch: text("branch"),
    conclusion: text("conclusion"),
    label: text("label"),
    labels: labels.join(", "),
    url: text("url"),
    title: text("title"),
  }
  const template = request.target.prompt_template
  if (template) {
    return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => facts[key] ?? whole)
  }
  const parts = [`A ${facts.kind} event fired in ${facts.repo || "this repository"}.`]
  if (facts.workflow) parts.push(`Workflow: ${facts.workflow}.`)
  if (facts.branch) parts.push(`Branch: ${facts.branch}.`)
  if (facts.conclusion) parts.push(`Conclusion: ${facts.conclusion}.`)
  if (facts.title) parts.push(`Title: ${facts.title}.`)
  if (facts.url) parts.push(`Link: ${facts.url}`)
  parts.push("Investigate the underlying problem, fix it, and verify the fix with the repo's own checks.")
  return parts.join(" ")
}

/** What the CLI's executor runs for a claimed request — a real
 * `grist run`. Injected so the cycle is testable without a model. */
export type ListenerExecRun = (input: {
  directory: string
  prompt: string
  environment?: string
  conversation?: string
  agent?: string
}) => Promise<{ sessionId?: string; ok: boolean; error?: string }>

export type ListenerCycleResult =
  | { status: "disabled" }
  | { status: "no_config" }
  | { status: "no_repo_identity" }
  | { status: "idle" }
  | { status: "contended"; requestId: string }
  | { status: "refused"; requestId: string; reason: string }
  | { status: "expired"; requestId: string }
  | {
      status: "completed"
      requestId: string
      sessionId?: string
      spendUsd: number
      outcome: "succeeded" | "failed"
      overRunCap: boolean
    }
  | { status: "error"; message: string }

/**
 * One runner cycle: opt-in check → queue read → repo match → claim →
 * execute → report. Processes at most one request (the oldest queued
 * for this repo); watch mode is cycles on an interval.
 */
export async function runListenerCycle(
  cwd: string,
  deps: ListenerRunnerDeps & { execRun: ListenerExecRun },
): Promise<ListenerCycleResult> {
  const now = deps.now ?? Date.now
  const state = loadListenerRunnerState(cwd, deps)
  if (!isListenerRunnerEnabled(state, runnerMachineName(deps))) return { status: "disabled" }
  const config = (deps.loadConfig ?? loadInviteConfig)()
  if (!config) return { status: "no_config" }
  const identity = repoIdentity(cwd, deps)
  if (!identity) return { status: "no_repo_identity" }
  try {
    const queued = await listQueuedListenerRequests(config, deps)
    const mine = queued
      .filter((request) => {
        const repo = typeof request.event.repo === "string" ? request.event.repo : ""
        return repo.toLowerCase() === identity.toLowerCase()
      })
      .sort((a, b) => a.created_at - b.created_at)
    const request = mine[0]
    if (!request) return { status: "idle" }

    const before = await inviteSpentUsd(config, deps)
    let claim: ListenerClaimOutcome
    try {
      claim = await claimListenerRequest(config, request.id, deps)
    } catch (error) {
      // Another runner won the race between list and claim.
      if (error instanceof GatewayHttpError && error.status === 409) {
        return { status: "contended", requestId: request.id }
      }
      throw error
    }
    if (!claim.claimed) {
      if ("refused" in claim) return { status: "refused", requestId: request.id, reason: claim.reason }
      return { status: "expired", requestId: request.id }
    }

    let execution: { sessionId?: string; ok: boolean; error?: string }
    try {
      execution = await deps.execRun({
        directory: cwd,
        prompt: renderListenerPrompt(claim.request),
        ...(claim.request.target.environment
          ? { environment: claim.request.target.environment }
          : {}),
        ...(claim.request.target.conversation
          ? { conversation: claim.request.target.conversation }
          : {}),
        ...(claim.request.target.agent ? { agent: claim.request.target.agent } : {}),
      })
    } catch (error) {
      execution = {
        ok: false,
        error: error instanceof Error ? error.message : "the run failed to start",
      }
    }
    const after = await inviteSpentUsd(config, deps)
    const spendUsd = Math.max(0, Math.round((after - before) * 1_000_000) / 1_000_000)
    const outcome = execution.ok ? "succeeded" : "failed"
    const { overRunCap } = await completeListenerRequest(
      config,
      {
        requestId: request.id,
        spendUsd,
        outcome,
        ...(execution.sessionId ? { sessionId: execution.sessionId } : {}),
        ...(execution.error ? { error: execution.error } : {}),
      },
      deps,
    )
    const next = loadListenerRunnerState(cwd, deps)
    next.last_run_at = now()
    delete next.last_error
    saveListenerRunnerState(cwd, next, deps)
    return {
      status: "completed",
      requestId: request.id,
      ...(execution.sessionId ? { sessionId: execution.sessionId } : {}),
      spendUsd,
      outcome,
      overRunCap,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      const next = loadListenerRunnerState(cwd, deps)
      next.last_error = message
      saveListenerRunnerState(cwd, next, deps)
    } catch {
      // State bookkeeping must never mask the real error.
    }
    return { status: "error", message }
  }
}

/** Watch mode: cycles on an interval until the signal aborts. */
export async function runListenerWatch(
  cwd: string,
  deps: ListenerRunnerDeps & {
    execRun: ListenerExecRun
    intervalMs?: number
    signal?: AbortSignal
    onCycle?: (result: ListenerCycleResult) => void
    sleep?: (ms: number) => Promise<void>
  },
): Promise<void> {
  const intervalMs = deps.intervalMs ?? 30_000
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  while (!deps.signal?.aborted) {
    const result = await runListenerCycle(cwd, deps)
    deps.onCycle?.(result)
    if (deps.signal?.aborted) return
    // A terminal opt-in/config state will not fix itself by polling.
    if (result.status === "disabled" || result.status === "no_config") return
    await sleep(intervalMs)
  }
}
