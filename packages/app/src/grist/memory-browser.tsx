import { createSignal, For, Show } from "solid-js"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"

/**
 * D5 — Grist memory browser: what Grist remembers about a project.
 *
 * Lists the verified-outcome records in the project's memory store
 * (server endpoint /api/grist/memory, the file store under
 * `<project>/.grist/memory.json`), with a text filter and a Forget
 * action per record. Scoped by the `directory` prop — Home passes the
 * most recently active project.
 */
export function GristMemoryBrowser(props: { directory?: string; label?: string }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const queryClient = useQueryClient()
  const [filter, setFilter] = createSignal("")

  const query = createQuery(() => ({
    queryKey: ["grist-memory", props.directory],
    enabled: !!props.directory,
    queryFn: () =>
      sdk.api.grist.memory
        .list({ location: { directory: props.directory! } })
        .catch(() => ({ backend: "file", records: [] })),
  }))

  const records = () => {
    const all = query.data?.records ?? []
    const needle = filter().trim().toLowerCase()
    return needle ? all.filter((record) => record.content.toLowerCase().includes(needle)) : all
  }

  const forget = async (id: string) => {
    if (!props.directory) return
    await sdk.api.grist.memory.forget({ location: { directory: props.directory }, id }).catch(() => undefined)
    void queryClient.invalidateQueries({ queryKey: ["grist-memory", props.directory] })
  }

  return (
    <Show when={props.directory}>
      <section aria-label={language.t("grist.memory.title")} class="flex min-h-0 flex-col gap-1">
        <h2 class="text-[13px] [line-height:var(--line-height-compact)] [font-weight:560]">
          {language.t("grist.memory.title")}
          <Show when={props.label}>
            <span class="text-v2-text-text-muted"> · {props.label}</span>
          </Show>
        </h2>
        <input
          class="rounded-md bg-v2-background-bg-layer-02 px-2 py-1 text-[13px] [line-height:var(--line-height-compact)]"
          placeholder={language.t("grist.memory.search")}
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        <Show when={!query.isLoading} fallback={<div class="px-2 py-1 text-[12px] text-v2-text-text-muted">{language.t("grist.memory.loading")}</div>}>
          <Show
            when={records().length > 0}
            fallback={<div class="px-2 py-1 text-[12px] text-v2-text-text-muted">{language.t("grist.memory.empty")}</div>}
          >
            <For each={records()}>
              {(record) => (
                <div class="flex items-start gap-2 rounded-md px-2 py-1 hover:bg-v2-background-bg-hover">
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="text-[13px] [line-height:var(--line-height-compact)]">{record.content}</span>
                    <span class="text-[11px] [line-height:var(--line-height-compact)] text-v2-text-text-muted">
                      {language.t(`grist.memory.outcome.${record.outcome}`)} ·{" "}
                      {new Date(record.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="rounded-md px-1.5 py-0.5 text-[12px] [line-height:var(--line-height-compact)] hover:bg-v2-background-bg-layer-02"
                    onClick={() => void forget(record.id)}
                  >
                    {language.t("grist.memory.forget")}
                  </button>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </section>
    </Show>
  )
}
