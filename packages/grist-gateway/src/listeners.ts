/**
 * Listeners (next-block spec §6): the gateway-side domain module for the
 * `listener` filesystem kind — definition shape, webhook event
 * normalization, and the deterministic filter match.
 *
 * A listener definition is a JSON document carried as the body of a
 * `listener` team object: config-as-data, versioned and diffable like
 * every other filesystem object. Admission (in http.ts) validates the
 * body through `parseListenerDefinition`; intake parses the same way, so
 * a definition the gateway evaluates is exactly the one it admitted.
 *
 * Everything here is pure and deterministic — no model calls anywhere in
 * the event path (D8). A normalized event either matches a listener's
 * trigger + filter predicates or it does not.
 */

export type ListenerSource = "github" | "generic"

/** The D8 v1 trigger set: CI failures + repo events, nothing else. */
export const LISTENER_EVENT_KINDS = [
  "ci_failure",
  "issue_opened",
  "issue_labeled",
  "pr_opened",
  "pr_labeled",
] as const

export type ListenerEventKind = (typeof LISTENER_EVENT_KINDS)[number]

/**
 * The spend envelope (spec §6.3): required fields with no defaults that
 * spend (D16) — an author must write the numbers. The same shape serves
 * as the team-admin ceiling a listener's envelope must fit within.
 */
export type ListenerEnvelope = {
  max_runs_per_day: number
  max_spend_per_day_usd: number
  max_spend_per_run_usd: number
}

export type ListenerDefinition = {
  version: 1
  trigger: { source: ListenerSource; event: ListenerEventKind }
  filter: {
    repo: string
    workflow?: string
    branch?: string
    label?: string
    conclusion?: string
  }
  target: {
    environment?: string
    conversation?: string
    agent?: string
    prompt_template?: string
  }
  envelope: ListenerEnvelope
  /** A listener fires only when its current version says `enabled: true`
   * — the kill switch is a new version with `enabled: false`, or remove
   * (spec §6.3). Absent means not enabled: proposed, not live (§6.5). */
  enabled: boolean
}

/**
 * One webhook delivery, normalized across sources so filter evaluation
 * never cares which door it came through. `kind` is one of the D8 kinds
 * for events in the v1 trigger set; anything else keeps its raw family
 * name (`workflow_run`, `push`, …) and can never match a listener, whose
 * trigger event admission restricts to the D8 set.
 */
export type NormalizedEvent = {
  source: ListenerSource
  kind: string
  repo?: string
  workflow?: string
  branch?: string
  conclusion?: string
  /** The label a `labeled` event added. */
  label?: string
  /** Every label currently on the issue/PR. */
  labels: string[]
  url?: string
  title?: string
}

const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const MAX_FILTER_FIELD = 256
const MAX_PROMPT_TEMPLATE = 8192

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function text(value: unknown, max = MAX_FILTER_FIELD): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return undefined
  return trimmed
}

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const entry of value) {
    const name = text(record(entry)?.name)
    if (name) names.push(name)
  }
  return names
}

/** Validate an envelope/ceiling shape; returns the cleaned numbers. */
export function parseListenerEnvelope(value: unknown): ListenerEnvelope | undefined {
  const envelope = record(value)
  if (!envelope) return undefined
  const runs = envelope.max_runs_per_day
  const perDay = envelope.max_spend_per_day_usd
  const perRun = envelope.max_spend_per_run_usd
  if (typeof runs !== "number" || !Number.isInteger(runs) || runs < 1 || runs > 100_000) {
    return undefined
  }
  if (typeof perDay !== "number" || !Number.isFinite(perDay) || perDay <= 0 || perDay > 1_000_000) {
    return undefined
  }
  if (typeof perRun !== "number" || !Number.isFinite(perRun) || perRun <= 0 || perRun > perDay) {
    return undefined
  }
  return { max_runs_per_day: runs, max_spend_per_day_usd: perDay, max_spend_per_run_usd: perRun }
}

/** Whether a listener's envelope claims more than the team ceiling allows. */
export function envelopeExceedsCeiling(envelope: ListenerEnvelope, ceiling: ListenerEnvelope): boolean {
  return (
    envelope.max_runs_per_day > ceiling.max_runs_per_day ||
    envelope.max_spend_per_day_usd > ceiling.max_spend_per_day_usd ||
    envelope.max_spend_per_run_usd > ceiling.max_spend_per_run_usd
  )
}

/**
 * Parse and validate a listener definition body. Returns undefined for
 * any shape failure — admission reports them all as one `invalid_schema`
 * reason, matching the other object kinds. A definition that parses is
 * safe for intake to evaluate without re-checking.
 */
export function parseListenerDefinition(body: string): ListenerDefinition | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  const definition = record(parsed)
  if (!definition) return undefined
  if (definition.version !== undefined && definition.version !== 1) return undefined

  const trigger = record(definition.trigger)
  if (!trigger) return undefined
  if (trigger.source !== "github" && trigger.source !== "generic") return undefined
  if (
    typeof trigger.event !== "string" ||
    !LISTENER_EVENT_KINDS.includes(trigger.event as ListenerEventKind)
  ) {
    return undefined
  }

  const filter = record(definition.filter)
  if (!filter) return undefined
  const repo = text(filter.repo)
  if (!repo || !REPO_SHAPE.test(repo)) return undefined
  const cleanedFilter: ListenerDefinition["filter"] = { repo }
  for (const field of ["workflow", "branch", "label", "conclusion"] as const) {
    if (filter[field] !== undefined) {
      const value = text(filter[field])
      if (!value) return undefined
      cleanedFilter[field] = value
    }
  }

  let target: ListenerDefinition["target"] = {}
  if (definition.target !== undefined) {
    const rawTarget = record(definition.target)
    if (!rawTarget) return undefined
    for (const field of ["environment", "conversation", "agent"] as const) {
      if (rawTarget[field] !== undefined) {
        const value = text(rawTarget[field])
        if (!value) return undefined
        target[field] = value
      }
    }
    if (rawTarget.prompt_template !== undefined) {
      const value = text(rawTarget.prompt_template, MAX_PROMPT_TEMPLATE)
      if (!value) return undefined
      target = { ...target, prompt_template: value }
    }
  }

  const envelope = parseListenerEnvelope(definition.envelope)
  if (!envelope) return undefined
  if (definition.enabled !== undefined && typeof definition.enabled !== "boolean") {
    return undefined
  }
  return {
    version: 1,
    trigger: { source: trigger.source, event: trigger.event as ListenerEventKind },
    filter: cleanedFilter,
    target,
    envelope,
    enabled: definition.enabled === true,
  }
}

/**
 * Normalize a GitHub webhook delivery. `eventName` is the X-GitHub-Event
 * header; `payload` is the parsed JSON body. Only the D8 families get
 * D8 kinds: a workflow_run that completed with a failure conclusion is
 * `ci_failure`; issues/pull_request opened/labeled map to their kinds.
 * Everything else keeps its family name and matches nothing.
 */
export function normalizeGithubEvent(eventName: string, payload: Record<string, unknown>): NormalizedEvent {
  const repository = record(payload.repository)
  const repo = text(repository?.full_name)
  const action = text(payload.action)
  if (eventName === "workflow_run") {
    const run = record(payload.workflow_run)
    const conclusion = text(run?.conclusion)
    return {
      source: "github",
      kind: action === "completed" && conclusion === "failure" ? "ci_failure" : "workflow_run",
      repo,
      workflow: text(run?.name),
      branch: text(run?.head_branch),
      conclusion,
      labels: [],
      url: text(run?.html_url, 1024),
    }
  }
  if (eventName === "issues" || eventName === "pull_request") {
    const item = record(eventName === "issues" ? payload.issue : payload.pull_request)
    const family = eventName === "issues" ? "issue" : "pr"
    const kind =
      action === "opened"
        ? `${family}_opened`
        : action === "labeled"
          ? `${family}_labeled`
          : eventName
    const head = record(item?.head)
    return {
      source: "github",
      kind,
      repo,
      branch: eventName === "pull_request" ? text(head?.ref) : undefined,
      label: text(record(payload.label)?.name),
      labels: labelNames(item?.labels),
      url: text(item?.html_url, 1024),
      title: text(item?.title, 1024),
    }
  }
  return { source: "github", kind: eventName, repo, labels: [] }
}

/**
 * Normalize a generic signed-webhook delivery. The sender posts the
 * normalized shape directly: `{ repo, kind, workflow?, branch?,
 * conclusion?, label?, labels?, url?, title? }`. A `kind` outside the
 * D8 set is carried through and matches nothing.
 */
export function normalizeGenericEvent(payload: Record<string, unknown>): NormalizedEvent {
  const kind = text(payload.kind, 64)
  return {
    source: "generic",
    kind: kind ?? "generic",
    repo: text(payload.repo),
    workflow: text(payload.workflow),
    branch: text(payload.branch),
    conclusion: text(payload.conclusion),
    label: text(payload.label),
    labels: labelNames(payload.labels),
    url: text(payload.url, 1024),
    title: text(payload.title, 1024),
  }
}

/**
 * The deterministic trigger + filter match (spec §6.2): source and event
 * kind, then every filter predicate the author wrote. Repo comparison
 * is case-insensitive (GitHub names are); everything else is exact.
 * `enabled` is deliberately NOT part of the match — intake checks it
 * separately so a matched-but-disabled listener audits distinctly.
 */
export function listenerTriggerMatches(definition: ListenerDefinition, event: NormalizedEvent): boolean {
  if (definition.trigger.source !== event.source) return false
  if (definition.trigger.event !== event.kind) return false
  const filter = definition.filter
  if (!event.repo || filter.repo.toLowerCase() !== event.repo.toLowerCase()) return false
  if (filter.workflow !== undefined && filter.workflow !== event.workflow) return false
  if (filter.branch !== undefined && filter.branch !== event.branch) return false
  if (filter.conclusion !== undefined && filter.conclusion !== event.conclusion) return false
  if (filter.label !== undefined && filter.label !== event.label && !event.labels.includes(filter.label)) {
    return false
  }
  return true
}

/** The event facts a run request carries (spec §6.2): the facts, never
 * a transcript of the event firehose. */
export function listenerEventSummary(event: NormalizedEvent): Record<string, unknown> {
  const summary: Record<string, unknown> = { kind: event.kind }
  if (event.repo) summary.repo = event.repo
  if (event.workflow) summary.workflow = event.workflow
  if (event.branch) summary.branch = event.branch
  if (event.conclusion) summary.conclusion = event.conclusion
  if (event.label) summary.label = event.label
  if (event.labels.length > 0) summary.labels = event.labels
  if (event.url) summary.url = event.url
  if (event.title) summary.title = event.title
  return summary
}
