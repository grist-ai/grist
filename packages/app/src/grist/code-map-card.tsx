import { For, Show } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"

/**
 * D5 — Grist code-map card: what the project's code map says.
 *
 * Renders the /api/grist/code-map summary for the `directory` prop:
 * graph size and the most-connected landmark nodes. When no Graphify
 * graph exists for the project yet, the card says so instead of
 * disappearing — an absent map is itself information.
 */
export function GristCodeMapCard(props: { directory?: string; label?: string }) {
  const language = useLanguage()
  const sdk = useServerSDK()

  const query = createQuery(() => ({
    queryKey: ["grist-code-map", props.directory],
    enabled: !!props.directory,
    queryFn: () =>
      sdk.api.grist.codeMap.get({ location: { directory: props.directory! } }).catch(() => undefined),
  }))

  return (
    <Show when={props.directory}>
      <section aria-label={language.t("grist.codemap.title")} class="flex min-h-0 flex-col gap-1">
        <h2 class="text-[13px] [line-height:var(--line-height-compact)] [font-weight:560]">
          {language.t("grist.codemap.title")}
          <Show when={props.label}>
            <span class="text-v2-text-text-muted"> · {props.label}</span>
          </Show>
        </h2>
        <Show when={query.data}>
          {(summary) => (
            <Show
              when={summary().available}
              fallback={<div class="px-2 py-1 text-[12px] text-v2-text-text-muted">{language.t("grist.codemap.absent")}</div>}
            >
              <div class="px-2 text-[12px] [line-height:var(--line-height-compact)] text-v2-text-text-muted">
                {language.t("grist.codemap.stats", { nodes: summary().nodes, edges: summary().edges })}
              </div>
              <For each={summary().top}>
                {(node) => (
                  <div class="flex items-center gap-2 rounded-md px-2 py-0.5">
                    <span class="min-w-0 flex-1 truncate text-[13px] [line-height:var(--line-height-compact)]">{node.label}</span>
                    <span class="text-[11px] [line-height:var(--line-height-compact)] text-v2-text-text-muted">
                      {language.t("grist.codemap.degree", { degree: node.degree })}
                    </span>
                  </div>
                )}
              </For>
            </Show>
          )}
        </Show>
      </section>
    </Show>
  )
}
