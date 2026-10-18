import { createMemo, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode/ui/toast"
import { useExtension } from "../sdk"
import type Review from "./index"
import type { ReviewModel } from "./model"

/**
 * Grist D3 — chunk actions for the review panel's active file, rendered
 * in the sidebar under the change tree. Accept stages one hunk in the
 * index; revert reverse-applies it to the working tree; commit lands
 * whatever is staged. Working-tree ("git") mode only — branch and turn
 * modes are historical views and stay read-only.
 */
export function ReviewActions(props: { review: ReviewModel }) {
  const ctx = useExtension<typeof Review>()
  const [state, setState] = createStore<{ message: string; busy: string | undefined }>({
    message: "",
    busy: undefined,
  })

  const activeFile = createMemo(() => {
    if (props.review.mode() !== "git") return undefined
    return props.review.activeFile()
  })
  // Bounded-context chunks for the active file, refetched whenever the
  // panel's diff version moves (an action refreshes it).
  const [parsed] = createResource(
    () => {
      const file = activeFile()
      return file ? { file, version: props.review.diffVersion() } : undefined
    },
    ({ file }) => props.review.actions.chunks(file),
  )

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (state.busy) return
    setState("busy", key)
    try {
      await action()
    } catch (error) {
      showToast({
        variant: "error",
        title: ctx.t("actions.failed"),
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setState("busy", undefined)
    }
  }

  const commit = () =>
    run("commit", async () => {
      const message = state.message.trim()
      if (!message) return
      await props.review.actions.commit(message)
      setState("message", "")
      showToast({ title: ctx.t("actions.committed") })
    })

  return (
    <Show when={parsed()}>
      {(value) => (
        <div class="flex flex-col gap-2 border-t border-v2-border-border-base px-2 py-2">
          <div class="text-[13px] [line-height:var(--line-height-compact)] [font-weight:560]">{ctx.t("actions.title")}</div>
          <For each={value().hunks}>
            {(hunk) => (
              <div class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate text-[12px] [line-height:var(--line-height-compact)] text-v2-text-text-muted">
                  {hunk.header}
                </span>
                <span class="text-[12px] [line-height:var(--line-height-compact)] text-v2-text-text-muted">
                  +{hunk.additions} −{hunk.deletions}
                </span>
                <button
                  type="button"
                  class="rounded-md px-1.5 py-0.5 text-[12px] [line-height:var(--line-height-compact)] hover:bg-v2-background-bg-hover"
                  disabled={state.busy !== undefined}
                  onClick={() => void run(hunk.id, () => props.review.actions.acceptHunk(hunk.file, hunk.id))}
                >
                  {ctx.t("actions.accept")}
                </button>
                <button
                  type="button"
                  class="rounded-md px-1.5 py-0.5 text-[12px] [line-height:var(--line-height-compact)] hover:bg-v2-background-bg-hover"
                  disabled={state.busy !== undefined}
                  onClick={() => void run(hunk.id, () => props.review.actions.revertHunk(hunk.file, hunk.id))}
                >
                  {ctx.t("actions.revert")}
                </button>
              </div>
            )}
          </For>
          <div class="flex items-center gap-2">
            <input
              class="min-w-0 flex-1 rounded-md bg-v2-background-bg-layer-02 px-2 py-1 text-[13px] [line-height:var(--line-height-compact)]"
              placeholder={ctx.t("actions.message")}
              value={state.message}
              onInput={(event) => setState("message", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void commit()
              }}
            />
            <button
              type="button"
              class="rounded-md px-2 py-1 text-[13px] [line-height:var(--line-height-compact)] hover:bg-v2-background-bg-hover"
              disabled={state.busy !== undefined || state.message.trim().length === 0}
              onClick={() => void commit()}
            >
              {ctx.t("actions.commit")}
            </button>
          </div>
        </div>
      )}
    </Show>
  )
}
