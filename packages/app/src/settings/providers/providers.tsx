import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { showToast } from "@/shell/notifications/toast"
import { popularProviders, useProviders } from "@/providers/catalog/providers"
import { useIntegrations } from "@/providers/catalog/integrations"
import { createEffect, createMemo, type Component, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { DialogConnectProvider, useProviderConnectController } from "@/providers/connect/dialog"
import { ProviderModelIcon } from "@/providers/models/provider-group"
import { SettingsList } from "@/settings/list"
import { activeProviderAccount, providerAccounts, type ProviderAccount } from "./accounts"
import "@/settings/settings.css"

type ProviderSource = "env" | "api" | "account" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id === "grist", key: "dialog.provider.grist.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

export const SettingsProviders: Component<{
  directory: string | undefined
  onSelectProvider?: (providerID: string) => void
}> = (props) => {
  const platform = usePlatform()
  // The desktop app hides all provider and model surfaces; authentication moves to Grist account login.
  if (platform.platform === "desktop") return null
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const data = useData()
  const providers = useProviders(() => props.directory)
  const integrations = useIntegrations(() => props.directory)
  const providerConnect = useProviderConnectController()
  const [state, setState] = createStore({
    disconnecting: {} as Record<string, "removing" | "removed" | "absent" | undefined>,
    connecting: false,
    credentialID: undefined as string | undefined,
  })
  const updateDisconnecting = (ids: string[], status: "removing" | "removed" | "absent" | undefined) =>
    setState("disconnecting", (current) => ({
      ...current,
      ...Object.fromEntries(ids.map((id) => [id, status])),
    }))
  // The lookup follows `integrationID` rather than the provider id.
  const integration = (item: ProviderItem) => {
    const id = item.integrationID ?? item.id
    return integrations.list().find((entry) => entry.id === id)
  }

  const connect = (provider?: string) => {
    setState("connecting", true)
    providerConnect.select(provider)
    void dialog.show(
      () => (
        <DialogConnectProvider
          directory={props.directory}
          defaultLocation={props.directory === undefined}
          controller={providerConnect}
          onConnected={(providerID) => {
            setState("disconnecting", providerID, undefined)
          }}
        />
      ),
      () => {
        setState("connecting", false)
        const location = props.directory ? { directory: props.directory } : undefined
        data.location.integration.invalidate(location)
        data.location.provider.invalidate(location)
        data.location.model.invalidate(location)
        void Promise.all([
          data.location.integration.sync(location),
          data.location.provider.sync(location),
          data.location.model.sync(location),
        ]).catch(() => undefined)
      },
    )
  }

  const available = createMemo(() => providers.connected())

  createEffect(() => {
    const ids = new Set(available().map((item) => item.id))
    Object.entries(state.disconnecting).forEach(([id, status]) => {
      if ((status === "removing" || status === "removed") && !ids.has(id)) {
        setState("disconnecting", id, "absent")
        return
      }
      if (status === "absent" && ids.has(id)) setState("disconnecting", id, undefined)
    })
  })

  const connected = createMemo(() => available().filter((item) => !state.disconnecting[item.id]))

  const displayed = createMemo(() => connected())

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  // Connection state comes from the integration list like the TUI: credential
  // connections mean an API key or OAuth grant, env connections mean detected
  // environment variables, and a connectionless integration is config-provided.
  const source = (item: ProviderItem): ProviderSource | undefined => {
    const current = integration(item)
    const credential = current?.connections.find((connection) => connection.type === "credential")
    if (credential) return credential.method === "oauth" ? "account" : "api"
    if (current?.connections.some((connection) => connection.type === "env")) return "env"
    if (current) return "config"
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "account") return language.t("settings.providers.tag.account")
    if (current === "config") return language.t("settings.providers.tag.config")
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => {
    const current = integration(item)
    if (current) return current.connections.some((connection) => connection.type === "credential")
    const currentSource = source(item)
    return currentSource !== "env" && currentSource !== "config"
  }

  const canManageAccounts = (item: ProviderItem) => providerAccounts(integration(item)).length > 0

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const disconnect = async (item: ProviderItem, name: string) => {
    if (state.disconnecting[item.id]) return
    const ids = [item.id]
    updateDisconnecting(ids, "removing")
    const location = props.directory ? { directory: props.directory } : undefined
    await serverSdk.api.integration
      .get({ integrationID: item.integrationID ?? item.id, location })
      .then(async (integration) => {
        const credentials = integration.data?.connections.filter((item) => item.type === "credential") ?? []
        if (credentials.length === 0) {
          showToast({
            title: language.t("common.requestFailed"),
            description: language.t("provider.disconnect.toast.noCredentials.description", { provider: name }),
          })
          return
        }
        await Promise.all(
          credentials.map((credential) => serverSdk.api.credential.remove({ credentialID: credential.id })),
        )
        updateDisconnecting(ids, "removed")
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        updateDisconnecting(ids, undefined)
        const message = err instanceof Error ? err.message : String(err)
        showToast({
          title: language.t("common.requestFailed"),
          description: language.tDynamic("provider.disconnect.toast.failed.description", message, { provider: name }),
        })
      })
  }

  const refreshAccounts = async () => {
    const location = props.directory ? { directory: props.directory } : undefined
    data.location.integration.invalidate(location)
    data.location.provider.invalidate(location)
    data.location.model.invalidate(location)
    await Promise.all([
      data.location.integration.sync(location),
      data.location.provider.sync(location),
      data.location.model.sync(location),
    ])
  }

  const accountError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    showToast({ title: language.t("common.requestFailed"), description: message })
  }

  const activate = async (provider: ProviderItem, providerName: string, account: ProviderAccount) => {
    if (activeProviderAccount(integration(provider))?.id === account.id) return
    setState("credentialID", account.id)
    await serverSdk.api.credential
      .activate({ credentialID: account.id })
      .then(refreshAccounts)
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.providers.account.switched.title", { provider: providerName }),
          description: language.t("settings.providers.account.switched.description", { account: account.label }),
        }),
      )
      .catch(accountError)
      .finally(() => setState("credentialID", undefined))
  }

  const remove = async (provider: ProviderItem, providerName: string, account: ProviderAccount) => {
    const final = providerAccounts(integration(provider)).length === 1
    setState("credentialID", account.id)
    await serverSdk.api.credential
      .remove({ credentialID: account.id })
      .then(refreshAccounts)
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t(
            final ? "provider.disconnect.toast.disconnected.title" : "settings.providers.account.removed.title",
            final ? { provider: providerName } : { account: account.label },
          ),
          description: language.t(
            final
              ? "provider.disconnect.toast.disconnected.description"
              : "settings.providers.account.removed.description",
            { provider: providerName },
          ),
        }),
      )
      .catch(accountError)
      .finally(() => setState("credentialID", undefined))
  }

  function AccountMenu(menuProps: { provider: ProviderItem; name?: string }) {
    const accounts = () => providerAccounts(integration(menuProps.provider))
    const active = () => activeProviderAccount(integration(menuProps.provider))
    const name = () => menuProps.name ?? menuProps.provider.name

    return (
      <Menu placement="bottom-end" gutter={6}>
        <Menu.Trigger
          as={Button}
          size="normal"
          variant="ghost-muted"
          class="settings-provider-account-trigger"
          aria-label={language.t("settings.providers.account.manage", { provider: name() })}
        >
          <span>{active()?.label}</span>
          <Icon name="chevron-down" size="small" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content class="settings-provider-account-menu" onEscapeKeyDown={(event) => event.stopPropagation()}>
            <Menu.Group>
              <Menu.GroupLabel>{language.t("settings.providers.account.group")}</Menu.GroupLabel>
              <Menu.RadioGroup
                class="settings-provider-account-list"
                value={active()?.id}
                onChange={(credentialID) => {
                  const account = accounts().find((item) => item.id === credentialID)
                  if (account) void activate(menuProps.provider, name(), account)
                }}
              >
                <For each={accounts()}>
                  {(account) => (
                    <Menu.RadioItem value={account.id} closeOnSelect disabled={state.credentialID !== undefined}>
                      <span class="settings-provider-account-label">{account.label}</span>
                    </Menu.RadioItem>
                  )}
                </For>
              </Menu.RadioGroup>
            </Menu.Group>
            <Menu.Separator />
            <Menu.Item disabled={state.credentialID !== undefined} onSelect={() => connect(menuProps.provider.id)}>
              {language.t("settings.providers.account.add")}
            </Menu.Item>
            <Menu.Sub placement="left-start">
              <Menu.SubTrigger disabled={state.credentialID !== undefined || accounts().length === 0}>
                {language.t("settings.providers.account.remove")}
              </Menu.SubTrigger>
              <Menu.SubContent class="settings-provider-account-submenu">
                <For each={accounts()}>
                  {(account) => (
                    <Menu.Item
                      badge={account.id === active()?.id ? language.t("settings.providers.account.active") : undefined}
                      onSelect={() => void remove(menuProps.provider, name(), account)}
                    >
                      <span class="settings-provider-account-label">{account.label}</span>
                    </Menu.Item>
                  )}
                </For>
              </Menu.SubContent>
            </Menu.Sub>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    )
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.providers.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.providers.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned settings-providers">
        <div class="settings-section" data-component="connected-providers-section">
          <h3 class="settings-section-title">{language.t("settings.providers.section.connected")}</h3>
          <SettingsList variant="catalog">
            <Show
              when={displayed().length > 0}
              fallback={<div class="settings-provider-empty">{language.t("settings.providers.connected.empty")}</div>}
            >
              <For each={displayed()}>
                {(item) => (
                  <div class="settings-provider-row group">
                    <div class="settings-provider-lead">
                      <ProviderModelIcon provider={item} class="settings-provider-icon shrink-0" />

                      <div class="settings-provider-main">
                        <span class="settings-provider-name truncate">
                          {item.name}
                        </span>
                        <Badge>{type(item)}</Badge>
                      </div>
                    </div>
                    <Show
                      when={canManageAccounts(item)}
                      fallback={
                        <Show
                          when={canDisconnect(item)}
                          fallback={
                            <span class="settings-provider-env-hint">
                              {language.t("settings.providers.connected.environmentDescription")}
                            </span>
                          }
                        >
                          <Button
                            size="normal"
                            variant="ghost-muted"
                            onClick={() => void disconnect(item, item.name)}
                          >
                            {language.t("common.disconnect")}
                          </Button>
                        </Show>
                      }
                    >
                      <AccountMenu provider={item} />
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.providers.section.popular")}</h3>
          <SettingsList variant="catalog">
            <For each={popular()}>
              {(item) => (
                <div class="settings-provider-row">
                  <div class="settings-provider-lead">
                    <ProviderModelIcon provider={item} class="settings-provider-icon shrink-0" />

                    <div class="settings-provider-copy">
                      <div class="settings-provider-main">
                        <span class="settings-provider-name">
                          {item.name}
                        </span>
                        <Show when={item.id === "grist"}>
                          <Badge>{language.t("dialog.provider.tag.recommended")}</Badge>
                        </Show>
                      </div>
                      <Show when={note(item.id)}>
                        {(key) => <p class="settings-provider-description">{language.t(key())}</p>}
                      </Show>
                    </div>
                  </div>
                  <Button size="normal" variant="neutral" icon="plus" onClick={() => connect(item.id)}>
                    {language.t("common.connect")}
                  </Button>
                </div>
              )}
            </For>
          </SettingsList>

          <button type="button" class="settings-providers-view-all" onClick={() => connect()}>
            {language.t("dialog.provider.viewAll")}
          </button>
        </div>
      </div>
    </>
  )
}
