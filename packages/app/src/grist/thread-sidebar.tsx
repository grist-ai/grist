import {
  groupThreadsByProject,
  isWorktreeDirectory,
  summaryFromSessionInfo,
  threadBadge,
  type ThreadStatus,
} from "@grist-ai/logic"
import type { SessionInfo } from "@opencode/client/promise"
import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

/**
 * D1 — Grist thread sidebar: the supervision view of sessions.
 *
 * Renders the D0/D1 thread model (grist-logic sidebar view-model):
 * threads grouped by project, running first, with status dots, unread
 * markers, and pending-request chips (permission asks + question forms
 * the client already tracks). Data arrives as plain props so the panel
 * can mount anywhere sessions are listed; opening a thread delegates to
 * the host via `onOpen`.
 */

const STATUS_COLOR: Record<ThreadStatus, string> = {
  running: "var(--v2-feedback-bg-info, #3b82f6)",
  succeeded: "var(--v2-feedback-bg-success, #22c55e)",
  failed: "var(--v2-feedback-bg-error, #ef4444)",
  interrupted: "var(--v2-feedback-bg-warning, #f59e0b)",
  idle: "var(--v2-icon-icon-muted, #9ca3af)",
}

export function GristThreadSidebar(props: {
  sessions: SessionInfo[]
  pending?: Record<string, number>
  /** Directories that are project worktrees (sandboxes); threads running in one get a marker. */
  worktreeDirs?: readonly string[]
  onOpen?: (sessionID: string) => void
}) {
  const language = useLanguage()
  const pending = createMemo(() => new Map(Object.entries(props.pending ?? {})))
  const groups = createMemo(() =>
    groupThreadsByProject(
      props.sessions.map((session) => summaryFromSessionInfo(session)),
      pending(),
    ),
  )
  const statusLabel = (status: ThreadStatus) => language.t(`grist.threads.status.${status}`)

  return (
    <section aria-label={language.t("grist.threads.title")} class="flex min-h-0 flex-col gap-3">
      <h2 class="text-[13px] [line-height:var(--line-height-compact)] [font-weight:560]">{language.t("grist.threads.title")}</h2>
      <For each={groups()}>
        {(group) => (
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <span class="text-[13px] [line-height:var(--line-height-compact)] [font-weight:530]">{group.label}</span>
              <Show when={group.pendingRequests > 0}>
                <span
                  class="rounded-full px-1.5 text-[11px] [line-height:var(--line-height-compact)]"
                  style={{ background: "var(--v2-feedback-bg-warning, #f59e0b)", color: "#fff" }}
                  title={language.t("grist.threads.pending")}
                >
                  {group.pendingRequests}
                </span>
              </Show>
              <Show when={group.unreadCount > 0}>
                <span
                  class="rounded-full px-1.5 text-[11px] [line-height:var(--line-height-compact)]"
                  style={{ background: "var(--v2-feedback-bg-info, #3b82f6)", color: "#fff" }}
                  title={language.t("grist.threads.unread")}
                >
                  {group.unreadCount}
                </span>
              </Show>
            </div>
            <For each={group.threads}>
              {(thread) => {
                const badge = threadBadge(thread, pending().get(thread.id) ?? 0)
                return (
                  <button
                    type="button"
                    class="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-v2-background-bg-hover"
                    onClick={() => props.onOpen?.(thread.id)}
                  >
                    <span
                      class="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: STATUS_COLOR[thread.status] }}
                      title={statusLabel(thread.status)}
                    />
                    <span
                      class="min-w-0 flex-1 truncate text-[13px] [line-height:var(--line-height-compact)]"
                      style={{ "font-weight": badge.unread ? 560 : 400 }}
                    >
                      {thread.title ?? language.t("grist.threads.untitled")}
                    </span>
                    <Show when={isWorktreeDirectory(thread.directory, props.worktreeDirs ?? [])}>
                      <span
                        class="rounded-full px-1.5 text-[11px] [line-height:var(--line-height-compact)]"
                        style={{ background: "var(--v2-background-bg-layer-02, #e5e7eb)", color: "var(--v2-text-text-muted, #6b7280)" }}
                        title={language.t("grist.threads.worktree")}
                      >
                        {language.t("grist.threads.worktree")}
                      </span>
                    </Show>
                    <Show when={badge.pendingRequests > 0}>
                      <span
                        class="rounded-full px-1.5 text-[11px] [line-height:var(--line-height-compact)]"
                        style={{ background: "var(--v2-feedback-bg-warning, #f59e0b)", color: "#fff" }}
                        title={language.t("grist.threads.pending")}
                      >
                        {badge.pendingRequests}
                      </span>
                    </Show>
                  </button>
                )
              }}
            </For>
          </div>
        )}
      </For>
    </section>
  )
}
