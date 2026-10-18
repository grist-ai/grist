import { reviewQueue, summaryFromSessionInfo, type ReviewReason } from "@grist-ai/logic"
import type { SessionInfo } from "@opencode/client/promise"
import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

/**
 * D4 — Grist review queue: the cross-project Needs-review inbox on Home.
 *
 * Renders the logic package's reviewQueue derivation over the same
 * session records as the thread sidebar: approvals first (from the
 * pending-request counts the host tracks), then failed and interrupted
 * threads, then finished work nobody has viewed yet. Threads started
 * by an automation (session metadata) carry its name — automation
 * output lands here like everything else; nothing merges itself.
 */

const REASON_COLOR: Record<ReviewReason, string> = {
  approval: "var(--v2-feedback-bg-warning, #f59e0b)",
  failed: "var(--v2-feedback-bg-error, #ef4444)",
  interrupted: "var(--v2-feedback-bg-warning, #f59e0b)",
  unreviewed: "var(--v2-feedback-bg-info, #3b82f6)",
}

export function GristReviewQueue(props: {
  sessions: SessionInfo[]
  pending?: Record<string, number>
  onOpen?: (sessionID: string) => void
}) {
  const language = useLanguage()
  const queue = createMemo(() => {
    const pendingApprovals = new Map(Object.entries(props.pending ?? {}))
    const automationBySession = new Map<string, string>()
    for (const session of props.sessions) {
      const automation = session.metadata?.automation
      if (typeof automation === "string") automationBySession.set(session.id, automation)
    }
    return reviewQueue(
      props.sessions.map((session) => summaryFromSessionInfo(session)),
      { pendingApprovals, automationBySession },
    )
  })

  return (
    <Show when={queue().length > 0}>
      <section aria-label={language.t("grist.queue.title")} class="flex min-h-0 flex-col gap-1">
        <h2 class="text-[13px] [line-height:var(--line-height-compact)] [font-weight:560]">
          {language.t("grist.queue.title")}
        </h2>
        <For each={queue()}>
          {(item) => (
            <button
              type="button"
              class="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-v2-background-bg-hover"
              onClick={() => props.onOpen?.(item.thread.id)}
            >
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                style={{ background: REASON_COLOR[item.reason] }}
                title={language.t(`grist.queue.reason.${item.reason}`)}
              />
              <span class="min-w-0 flex-1 truncate text-[13px] [line-height:var(--line-height-compact)]">
                {item.thread.title ?? language.t("grist.threads.untitled")}
              </span>
              <Show when={item.automationID}>
                {(automationID) => (
                  <span
                    class="rounded-full px-1.5 text-[11px] [line-height:var(--line-height-compact)]"
                    style={{
                      background: "var(--v2-background-bg-layer-02, #e5e7eb)",
                      color: "var(--v2-text-text-muted, #6b7280)",
                    }}
                    title={language.t("grist.queue.automation")}
                  >
                    {automationID()}
                  </span>
                )}
              </Show>
              <span class="text-[11px] [line-height:var(--line-height-compact)] text-v2-text-text-muted">
                {language.t(`grist.queue.reason.${item.reason}`)}
              </span>
            </button>
          )}
        </For>
      </section>
    </Show>
  )
}
