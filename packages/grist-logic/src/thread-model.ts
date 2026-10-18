/**
 * D0 — the thread model: a supervision-shaped projection of a session.
 *
 * The Codex app's core insight is that a desktop client should supervise
 * THREADS (per project, with status, items, and approvals), not mirror a
 * single chat. Grist's v2 runtime already records everything needed as
 * durable session events (`@opencode/schema/session-event`, ~52 types,
 * stored per session in the `event` table and streamed on the server
 * event-feed). This module is the pure, tested mapping from those events
 * to the thread view D1's UI will render:
 *
 *   session            → thread
 *   durable events     → thread items (message / reasoning / tool / step /
 *                        shell / compaction / usage / outcome / lifecycle)
 *   Jev gate ask_human → approval_request item (approvals are requests a
 *                        client answers, exactly as in the Codex protocol)
 *
 * Ephemeral delta events (text/reasoning/tool-input deltas) map to
 * `undefined`: they are live-streaming fragments, and the durable
 * `*.ended` events carry the replayable full values.
 *
 * Two sources, one view: the mapping above serves the LIVE event-feed.
 * For REPLAY (a client opening an old thread), this build's runtime does
 * not retain the raw event log — it projects events into `session_v2` +
 * `session_message` rows. `summaryFromStoredRow` /
 * `itemsFromStoredMessages` below project those stored rows into the
 * exact same ThreadSummary/ThreadItem shapes, so D1 renders one model
 * regardless of source.
 */

export type SessionEventLike = {
  type: string
  data?: Record<string, unknown>
}

export type ThreadStatus = "running" | "succeeded" | "failed" | "interrupted" | "idle"

export type ThreadItem =
  | { kind: "message"; messageID?: string; text: string }
  | { kind: "reasoning"; messageID?: string; text: string }
  | { kind: "tool"; toolCallID?: string; name: string; phase: "called" | "success" | "failed"; error?: string }
  | { kind: "step"; messageID?: string; cost?: number; files?: string[] }
  | { kind: "shell"; phase: "started" | "ended" }
  | { kind: "compaction"; phase: "started" | "ended" | "failed" }
  | { kind: "usage"; cost?: number; inputTokens?: number; outputTokens?: number }
  | { kind: "outcome"; status: Exclude<ThreadStatus, "running" | "idle"> }
  | { kind: "approval_request"; source: "jev_gate"; reason?: string; rung?: string }
  | { kind: "lifecycle"; event: string }

export type ThreadSummary = {
  id: string
  title?: string
  projectID?: string
  directory?: string
  parentID?: string
  forkedFrom?: string
  status: ThreadStatus
  viewed?: boolean
  updatedAt?: number
  viewedAt?: number
  archivedAt?: number
  totalCost: number
  stepCount: number
  itemCount: number
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function tokensOf(data: Record<string, unknown>): { input?: number; output?: number } {
  const tokens = data.tokens as Record<string, unknown> | undefined
  if (!tokens) return {}
  return { input: num(tokens.input), output: num(tokens.output) }
}

/** One durable session event → one thread item (or undefined for ephemeral/unmapped). */
export function itemFromSessionEvent(event: SessionEventLike): ThreadItem | undefined {
  const data = event.data ?? {}
  switch (event.type) {
    case "session.text.ended":
      return { kind: "message", messageID: str(data.assistantMessageID), text: str(data.text) ?? "" }
    case "session.reasoning.ended":
      return { kind: "reasoning", messageID: str(data.assistantMessageID), text: str(data.text) ?? "" }
    case "session.tool.called":
      return { kind: "tool", toolCallID: str(data.id), name: str(data.name) ?? "tool", phase: "called" }
    case "session.tool.success":
      return { kind: "tool", toolCallID: str(data.id), name: str(data.name) ?? "tool", phase: "success" }
    case "session.tool.failed":
      return {
        kind: "tool",
        toolCallID: str(data.id),
        name: str(data.name) ?? "tool",
        phase: "failed",
        error: str((data.error as Record<string, unknown> | undefined)?.message) ?? str(data.error as unknown),
      }
    case "session.step.ended": {
      const files = Array.isArray(data.files) ? data.files.filter((f): f is string => typeof f === "string") : undefined
      return { kind: "step", messageID: str(data.assistantMessageID), cost: num(data.cost), files }
    }
    case "session.step.failed":
      return { kind: "step", messageID: str(data.assistantMessageID), cost: num(data.cost) }
    case "session.shell.started":
      return { kind: "shell", phase: "started" }
    case "session.shell.ended":
      return { kind: "shell", phase: "ended" }
    case "session.compaction.started":
      return { kind: "compaction", phase: "started" }
    case "session.compaction.ended":
      return { kind: "compaction", phase: "ended" }
    case "session.compaction.failed":
      return { kind: "compaction", phase: "failed" }
    case "session.usage.recorded": {
      const t = tokensOf(data)
      return { kind: "usage", cost: num(data.cost), inputTokens: t.input, outputTokens: t.output }
    }
    case "session.execution.succeeded":
      return { kind: "outcome", status: "succeeded" }
    case "session.execution.failed":
      return { kind: "outcome", status: "failed" }
    case "session.execution.interrupted":
      return { kind: "outcome", status: "interrupted" }
    case "session.created":
    case "session.renamed":
    case "session.moved":
    case "session.forked":
    case "session.viewed":
    case "session.deleted":
    case "session.agent.selected":
    case "session.model.selected":
    case "session.metadata.updated":
    case "session.inbox.enqueued":
    case "session.inbox.delivered":
      return { kind: "lifecycle", event: event.type }
    default:
      // Ephemeral deltas (live-only fragments) and anything unmapped.
      return undefined
  }
}

/** A Jev gate decision routed to ask_human is an approval request to the client. */
export function approvalItemFromGateDecision(decision: {
  route?: unknown
  reason?: unknown
  rung?: unknown
}): ThreadItem | undefined {
  if (decision.route !== "ask_human") return undefined
  return {
    kind: "approval_request",
    source: "jev_gate",
    reason: str(decision.reason),
    rung: str(decision.rung),
  }
}

/** Fold one session's durable events (in seq order) into a thread summary + items. */
export function projectThread(
  sessionID: string,
  events: SessionEventLike[],
): { summary: ThreadSummary; items: ThreadItem[] } {
  const summary: ThreadSummary = {
    id: sessionID,
    status: "idle",
    totalCost: 0,
    stepCount: 0,
    itemCount: 0,
  }
  const items: ThreadItem[] = []
  for (const event of events) {
    const data = event.data ?? {}
    switch (event.type) {
      case "session.created":
        summary.projectID = str(data.projectID) ?? summary.projectID
        summary.title = str(data.title) ?? summary.title
        summary.parentID = str(data.parentID) ?? summary.parentID
        break
      case "session.renamed":
        summary.title = str(data.title) ?? summary.title
        break
      case "session.moved":
        summary.projectID = str(data.projectID) ?? summary.projectID
        break
      case "session.forked":
        summary.forkedFrom = str(data.sourceSessionID) ?? str(data.parentID) ?? summary.forkedFrom
        break
      case "session.viewed":
        summary.viewed = true
        break
      case "session.execution.started":
        summary.status = "running"
        break
      case "session.execution.succeeded":
        summary.status = "succeeded"
        break
      case "session.execution.failed":
        summary.status = "failed"
        break
      case "session.execution.interrupted":
        summary.status = "interrupted"
        break
      case "session.step.ended":
        summary.stepCount += 1
        summary.totalCost += num(data.cost) ?? 0
        break
      case "session.usage.recorded":
        // Usage rows accompany step rows in most streams; only add cost
        // when no step cost has been counted to avoid double-counting.
        break
    }
    const item = itemFromSessionEvent(event)
    if (item) items.push(item)
  }
  summary.itemCount = items.length
  return { summary, items }
}

/** A `session_v2` row (snake_case, as stored) → thread summary. */
export type StoredSessionRow = {
  id: string
  title?: string | null
  directory?: string | null
  project_id?: string | null
  parent_id?: string | null
  fork_session_id?: string | null
  cost?: number | null
}

export function summaryFromStoredRow(row: StoredSessionRow, status: ThreadStatus, stepCount: number, itemCount: number): ThreadSummary {
  return {
    id: row.id,
    title: str(row.title ?? undefined),
    projectID: str(row.project_id ?? undefined),
    directory: str(row.directory ?? undefined),
    parentID: str(row.parent_id ?? undefined),
    forkedFrom: str(row.fork_session_id ?? undefined),
    status,
    totalCost: num(row.cost ?? undefined) ?? 0,
    stepCount,
    itemCount,
  }
}

export type StoredMessage = { type: string; data?: Record<string, unknown> }

/** Thread status from stored messages: the last `idle` outcome wins. */
export function statusFromStoredMessages(messages: StoredMessage[]): ThreadStatus {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type === "idle") {
      const outcome = str(m.data?.outcome)
      if (outcome === "succeeded" || outcome === "failed" || outcome === "interrupted") return outcome
    }
  }
  return "idle"
}

/** Stored `session_message` rows (in seq order) → thread items. */
export function itemsFromStoredMessages(messages: StoredMessage[]): ThreadItem[] {
  const items: ThreadItem[] = []
  for (const message of messages) {
    const data = message.data ?? {}
    switch (message.type) {
      case "assistant": {
        const content = Array.isArray(data.content) ? (data.content as Record<string, unknown>[]) : []
        for (const part of content) {
          if (part.type === "text") items.push({ kind: "message", text: str(part.text) ?? "" })
          else if (part.type === "reasoning") items.push({ kind: "reasoning", text: str(part.text) ?? "" })
          else if (part.type === "tool") {
            const state = (part.state ?? {}) as Record<string, unknown>
            const status = str(state.status)
            const phase = status === "completed" ? "success" : status === "error" ? "failed" : "called"
            const error =
              phase === "failed"
                ? (str((state.error as Record<string, unknown> | undefined)?.message) ?? str(state.error as unknown))
                : undefined
            items.push({ kind: "tool", toolCallID: str(part.id), name: str(part.name) ?? "tool", phase, error })
          }
        }
        const snapshot = data.snapshot as Record<string, unknown> | undefined
        const files = Array.isArray(snapshot?.files)
          ? (snapshot.files as unknown[]).filter((f): f is string => typeof f === "string")
          : undefined
        items.push({ kind: "step", cost: num(data.cost), files })
        break
      }
      case "compaction": {
        const raw = str((data.state as Record<string, unknown> | undefined)?.status) ?? str(data.status) ?? ""
        const phase = raw.includes("fail") ? "failed" : raw.includes("run") || raw.includes("start") ? "started" : "ended"
        items.push({ kind: "compaction", phase })
        break
      }
      case "shell":
        items.push({ kind: "shell", phase: data.exit !== undefined || str(data.status) === "completed" ? "ended" : "started" })
        break
      case "idle": {
        const outcome = str(data.outcome)
        if (outcome === "succeeded" || outcome === "failed" || outcome === "interrupted")
          items.push({ kind: "outcome", status: outcome })
        break
      }
      default:
        items.push({ kind: "lifecycle", event: `stored.${message.type}` })
    }
  }
  return items
}

/** Sidebar ordering: running first, then most recently active (highest last seq). */
export function orderThreads<T extends { summary: ThreadSummary; lastSeq: number }>(threads: T[]): T[] {
  const rank = (s: ThreadStatus): number => (s === "running" ? 0 : s === "idle" ? 1 : 2)
  return [...threads].sort((a, b) => rank(a.summary.status) - rank(b.summary.status) || b.lastSeq - a.lastSeq)
}
