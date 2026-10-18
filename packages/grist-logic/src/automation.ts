/**
 * D4 — automations and the review queue.
 *
 * An AUTOMATION is a named template that starts a thread on a schedule:
 * a prompt, a project directory, a schedule, and whether the run gets
 * its own worktree (D2). Runs are ordinary sessions carrying the
 * automation's id in their session metadata; nothing an automation
 * produces merges itself — its threads land in the REVIEW QUEUE like
 * everything else that needs a human decision.
 *
 * This module is the pure half: the template and store shapes, the due
 * logic (deterministic — `now` is always an input), the two built-in
 * templates (Dreaming curation, failure-mining digest — the R3/R4
 * operator scripts as scheduled threads), and the queue derivation
 * over D0 thread summaries. The runner that ticks the store and starts
 * sessions is `script/grist-automations.ts`.
 */

import type { ThreadSummary } from "./thread-model.js"

export type AutomationSchedule =
  | { kind: "interval"; everyMinutes: number }
  | { kind: "daily"; at: string } // "HH:MM", local time
  | { kind: "weekly"; weekday: number; at: string } // weekday: 0 = Sunday

export type AutomationTemplate = {
  id: string
  name: string
  prompt: string
  /** Absolute project directory the thread runs in. */
  directory: string
  schedule: AutomationSchedule
  /** Start the run in its own worktree + auto-named branch (D2). */
  worktree: boolean
  enabled: boolean
}

export type AutomationRun = {
  templateID: string
  sessionID: string
  startedAt: number
}

export type AutomationStore = {
  templates: AutomationTemplate[]
  lastRunAt: Record<string, number>
  runs: AutomationRun[]
}

export const emptyAutomationStore = (): AutomationStore => ({ templates: [], lastRunAt: {}, runs: [] })

export function parseAutomationStore(text: string): AutomationStore {
  const raw = JSON.parse(text) as Partial<AutomationStore>
  return {
    templates: Array.isArray(raw.templates) ? raw.templates : [],
    lastRunAt: typeof raw.lastRunAt === "object" && raw.lastRunAt !== null ? raw.lastRunAt : {},
    runs: Array.isArray(raw.runs) ? raw.runs : [],
  }
}

export function serializeAutomationStore(store: AutomationStore): string {
  return JSON.stringify(store, null, 2) + "\n"
}

const MINUTE = 60_000

function atMinutes(at: string): number {
  const [hours, minutes] = at.split(":").map((part) => Number(part))
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0)
}

function startOfDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Whether a template is due at `now`: never-run templates are due
 * immediately; afterwards the schedule decides (interval elapsed since
 * the last run; daily/weekly once the scheduled time has passed on a
 * day the template has not yet run).
 */
export function isDue(template: AutomationTemplate, lastRunAt: number | undefined, now: number): boolean {
  if (!template.enabled) return false
  if (lastRunAt === undefined) return true
  const schedule = template.schedule
  if (schedule.kind === "interval") return now - lastRunAt >= schedule.everyMinutes * MINUTE
  const todayStart = startOfDay(now)
  const scheduledToday = todayStart + atMinutes(schedule.at) * MINUTE
  if (schedule.kind === "daily") return now >= scheduledToday && lastRunAt < scheduledToday
  // weekly
  const daysSince = (new Date(now).getDay() - schedule.weekday + 7) % 7
  const scheduledThisWeek = todayStart - daysSince * 24 * 60 * MINUTE + atMinutes(schedule.at) * MINUTE
  return now >= scheduledThisWeek && lastRunAt < scheduledThisWeek
}

/** Templates due at `now`, in store order. */
export function dueAutomations(store: AutomationStore, now: number): AutomationTemplate[] {
  return store.templates.filter((template) => isDue(template, store.lastRunAt[template.id], now))
}

/** The two built-in automations (R3/R4 operator scripts as threads). */
export function builtinAutomations(directory: string): AutomationTemplate[] {
  return [
    {
      id: "failure-mining-digest",
      name: "Failure-mining digest",
      prompt:
        "Run the failure-mining pass for this project: bun script/grist-failure-mining.ts in the Grist repo. Then summarize what it found: the repeated failure signatures, any new negative memories recorded, and the single most important fix to make next. Keep the summary under 200 words.",
      directory,
      schedule: { kind: "daily", at: "09:00" },
      worktree: false,
      enabled: true,
    },
    {
      id: "dreaming-curation",
      name: "Dreaming curation",
      prompt:
        "Run the Dreaming curation pass: bun script/grist-dream.ts in the Grist repo. Then summarize what it did: memories merged, archived, or superseded; any contradictions flagged; and whether the Agent Memory Repo commit landed. Keep the summary under 200 words. Do not merge anything yourself — curation output is reviewed by a human.",
      directory,
      schedule: { kind: "weekly", weekday: 1, at: "09:00" },
      worktree: false,
      enabled: true,
    },
  ]
}

export type ReviewReason = "approval" | "failed" | "interrupted" | "unreviewed"

export type ReviewQueueItem = {
  thread: ThreadSummary
  reason: ReviewReason
  /** The automation that started this thread, when known. */
  automationID?: string
}

const REASON_ORDER: Record<ReviewReason, number> = { approval: 0, failed: 1, interrupted: 2, unreviewed: 3 }

/**
 * The Needs-review queue over thread summaries: approvals first (when a
 * caller can supply pending counts), then failures and interruptions,
 * then finished work nobody has looked at yet (updated after it was
 * last viewed). Running threads and archived threads never queue.
 * Automation origin is attached from the caller's map (session metadata
 * in the app, the runner's store in scripts).
 */
export function reviewQueue(
  threads: readonly ThreadSummary[],
  input?: { pendingApprovals?: ReadonlyMap<string, number>; automationBySession?: ReadonlyMap<string, string> },
): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = []
  for (const thread of threads) {
    if (thread.archivedAt !== undefined) continue
    const automationID = input?.automationBySession?.get(thread.id)
    const pending = input?.pendingApprovals?.get(thread.id) ?? 0
    if (pending > 0) {
      items.push({ thread, reason: "approval", automationID })
      continue
    }
    if (thread.status === "failed" || thread.status === "interrupted") {
      items.push({ thread, reason: thread.status, automationID })
      continue
    }
    if (thread.status === "running") continue
    const updated = thread.updatedAt ?? 0
    const viewed = thread.viewedAt ?? 0
    if (updated > viewed) items.push({ thread, reason: "unreviewed", automationID })
  }
  return items.sort((a, b) => {
    const byReason = REASON_ORDER[a.reason] - REASON_ORDER[b.reason]
    if (byReason !== 0) return byReason
    return (b.thread.updatedAt ?? 0) - (a.thread.updatedAt ?? 0)
  })
}
