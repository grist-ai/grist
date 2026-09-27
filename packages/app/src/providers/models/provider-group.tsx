import { Badge } from "@opencode/ui/badge"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { iconNames, type IconName } from "@opencode/ui/icons/provider"
import { Menu } from "@opencode/ui/menu"
import { ProviderIcon } from "@opencode/ui/provider-icon"
import type { JSX } from "solid-js"
import { For, Match, Show, Switch } from "solid-js"
import { GristLogo } from "@/providers/grist-logo"
import { useLanguage } from "@/runtime/i18n/language"
import customManagedProvider from "@/providers/custom-managed-provider.svg"
import "@/settings/settings.css"

type ModelProvider = { id: string; canonical?: string; name: string }
type ModelItem = { provider: ModelProvider & { integrationID?: string }; cost?: { input: number } }
type ModelGroup<T> = { category: string; items: T[] }

export function CustomManagedProviderIcon(props: { class?: string }) {
  return <img data-component="custom-managed-provider-icon" src={customManagedProvider} alt="" class={props.class} />
}

export function ProviderModelIcon(props: { provider: ModelProvider; class?: string }) {
  const icon = () =>
    [
      props.provider.canonical,
      props.provider.canonical?.replace(/-token-plan$/, ""),
      props.provider.id,
    ].find((id): id is IconName => !!id && id !== "synthetic" && iconNames.includes(id as IconName))

  return (
    <Switch>
      <Match when={props.provider.id === "grist"}>
        <GristLogo class={`size-4 ${props.class ?? ""}`} />
      </Match>
      <Match when={icon()} keyed>
        {(id) => <ProviderIcon id={id} width={16} height={16} class={props.class} />}
      </Match>
      <Match when={true}>
        <CustomManagedProviderIcon class={`size-4 ${props.class ?? ""}`} />
      </Match>
    </Switch>
  )
}

/** Provider sections for a model list. */
export function ProviderModelSections<T extends ModelItem>(props: {
  groups: ModelGroup<T>[]
  expanded: (key: string) => boolean
  disabled: boolean
  onExpandedChange: (key: string, expanded: boolean) => void
  rows: (items: T[]) => JSX.Element
  /** Trailing control in a direct provider's header. */
  action?: (group: ModelGroup<T>) => JSX.Element
  onSetVisibility?: (providerID: string, visible: boolean) => void
  ref?: (providerID: string, element: HTMLElement) => void
}) {
  function Header(input: { id: string; icon: JSX.Element; title: JSX.Element; badge?: string; action?: JSX.Element }) {
    return (
      <h3 class="settings-models-group-header" classList={{ "justify-between": !!input.action }}>
        <button
          type="button"
          class="settings-models-group-trigger"
          aria-expanded={props.expanded(input.id)}
          disabled={props.disabled}
          onClick={() => props.onExpandedChange(input.id, !props.expanded(input.id))}
        >
          <span class="settings-models-group-chevron">
            <Icon name="chevron-down" size="small" classList={{ collapsed: !props.expanded(input.id) }} />
          </span>
          <span class="settings-models-group-label">
            {input.icon}
            <bdi class="settings-models-group-title">{input.title}</bdi>
            <Show when={input.badge}>{(badge) => <Badge>{badge()}</Badge>}</Show>
          </span>
        </button>
        {input.action}
      </h3>
    )
  }

  return (
    <For each={props.groups}>
      {(group) => (
        <section
          ref={(element) => props.ref?.(group.category, element)}
          class="settings-section"
          data-component="settings-models-provider"
          data-expanded={props.expanded(group.category) ? "" : undefined}
        >
          <Header
            id={group.category}
            icon={<ProviderModelIcon provider={group.items[0].provider} class="shrink-0" />}
            title={group.items[0].provider.name}
            action={props.action?.(group)}
          />
          <Show when={props.expanded(group.category)}>{props.rows(group.items)}</Show>
        </section>
      )}
    </For>
  )
}

export function ProviderModelGroup(props: {
  provider: ModelProvider
  name?: string
  expanded: boolean
  disabled?: boolean
  onSetVisibility?: (visible: boolean) => void
  children: JSX.Element
  ref?: (element: HTMLElement) => void
  onExpandedChange: (expanded: boolean) => void
}) {
  const language = useLanguage()
  return (
    <section
      ref={props.ref}
      class="provider-model-group"
      data-component="provider-model-group"
      data-provider={props.provider.id}
      data-expanded={props.expanded ? "" : undefined}
    >
      <h3 class="provider-model-group-header">
        <button
          type="button"
          class="provider-model-group-trigger"
          aria-expanded={props.expanded}
          disabled={props.disabled}
          onClick={() => props.onExpandedChange(!props.expanded)}
        >
          <span class="provider-model-group-label">
            <ProviderModelIcon provider={props.provider} class="shrink-0" />
            <bdi class="provider-model-group-title">{props.name ?? props.provider.name}</bdi>
            <Icon
              name="chevron-down"
              size="small"
              classList={{ "provider-model-group-chevron": true, collapsed: !props.expanded }}
            />
          </span>
        </button>
        <Show when={props.onSetVisibility} keyed>
          {(setVisibility) => (
            <div class="provider-model-group-actions">
              <Menu gutter={4} modal={false} placement="bottom-end">
                <Menu.Trigger
                  as={IconButton}
                  variant="ghost-muted"
                  size="small"
                  icon={<Icon name="outline-dots" />}
                  aria-label={language.t("common.moreOptions")}
                />
                <Menu.Portal>
                  <Menu.Content>
                    <Menu.Item onSelect={() => setVisibility(true)}>{language.t("settings.models.enableAll")}</Menu.Item>
                    <Menu.Item onSelect={() => setVisibility(false)}>
                      {language.t("settings.models.disableAll")}
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            </div>
          )}
        </Show>
      </h3>
      <Show when={props.expanded}>
        <div class="provider-model-group-models">{props.children}</div>
      </Show>
    </section>
  )
}
