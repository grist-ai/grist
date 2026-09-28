import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createSignal, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { GristAuthDeviceStart } from "@/grist-auth"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"

type DevicePhase = "idle" | "starting" | "waiting" | "error"

const API_KEY_PATTERN = /^grist_sk_[0-9a-f]{64}$/i

export function SettingsAccount() {
  const language = useLanguage()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const auth = platform.gristAuth
  if (!auth) return null

  const status = useQuery(() => ({
    queryKey: ["grist-auth", "status"],
    queryFn: () => auth.status(),
  }))
  // Reading pending query data would suspend the entire settings surface.
  const current = () => (status.isSuccess ? status.data : undefined)

  const [device, setDevice] = createStore({
    phase: "idle" as DevicePhase,
    start: undefined as GristAuthDeviceStart | undefined,
    error: undefined as "unreachable" | "expired" | undefined,
  })
  const [copied, setCopied] = createSignal(false)
  const [apiKey, setApiKey] = createSignal("")
  const [keyError, setKeyError] = createSignal<"invalid" | "failed" | undefined>()

  let pollTimer: number | undefined
  const stopPolling = () => {
    if (pollTimer === undefined) return
    clearTimeout(pollTimer)
    pollTimer = undefined
  }
  onCleanup(stopPolling)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["grist-auth", "status"] })

  const beginWaiting = (start: GristAuthDeviceStart) => {
    setDevice({ phase: "waiting", start, error: undefined })
    const deadline = Date.now() + start.expiresIn * 1000
    const tick = async () => {
      if (Date.now() >= deadline) {
        setDevice({ phase: "error", error: "expired" })
        return
      }
      const result = await auth.pollDevice(start.deviceCode).catch(() => ({ status: "pending" as const }))
      if (result.status === "approved") {
        setDevice({ phase: "idle", start: undefined })
        await refresh()
        return
      }
      if (result.status === "expired") {
        setDevice({ phase: "error", error: "expired" })
        return
      }
      pollTimer = window.setTimeout(tick, Math.max(1, start.interval) * 1000)
    }
    pollTimer = window.setTimeout(tick, Math.max(1, start.interval) * 1000)
  }

  const startLogin = async () => {
    if (device.phase === "starting" || device.phase === "waiting") return
    setDevice({ phase: "starting", error: undefined })
    try {
      beginWaiting(await auth.startDevice())
    } catch {
      setDevice({ phase: "error", error: "unreachable" })
    }
  }

  const cancelLogin = () => {
    stopPolling()
    setDevice({ phase: "idle", start: undefined, error: undefined })
  }

  const openVerification = () => {
    const url = device.start?.verificationUri
    if (!url) return
    void platform.openBrowser?.(url)
  }

  const copyCode = async () => {
    const code = device.start?.userCode
    if (!code) return
    await (platform.writeClipboardText?.(code) ?? navigator.clipboard.writeText(code)).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const logout = useMutation(() => ({
    mutationFn: () => auth.logout(),
    onSuccess: () => refresh(),
  }))

  const saveKey = useMutation(() => ({
    mutationFn: async (value: string) => {
      await auth.saveApiKey(value)
    },
    onSuccess: () => {
      setApiKey("")
      setKeyError(undefined)
      void refresh()
    },
    onError: () => setKeyError("failed"),
  }))

  const submitKey = () => {
    const value = apiKey().trim()
    if (!API_KEY_PATTERN.test(value)) {
      setKeyError("invalid")
      return
    }
    setKeyError(undefined)
    saveKey.mutate(value)
  }

  const signedIn = () => current()?.signedIn === true
  const waitingStart = () => (device.phase === "waiting" ? device.start : undefined)
  const gatewayDescription = () => {
    const url = current()?.gatewayUrl
    return url ? language.t("settings.account.gateway", { url }) : ""
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.account.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.account.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <Show when={signedIn()}>
          <section class="settings-section" aria-label={language.t("settings.account.signedIn.title")}>
            <SettingsList>
              <SettingsRow
                title={language.t(
                  current()?.kind === "api_key"
                    ? "settings.account.signedIn.apiKey"
                    : "settings.account.signedIn.device",
                )}
                description={gatewayDescription()}
              >
                <Button variant="danger" disabled={logout.isPending} onClick={() => logout.mutate()}>
                  {language.t("settings.account.logout")}
                </Button>
              </SettingsRow>
            </SettingsList>
            <Show when={logout.error}>
              <p class="text-text-danger-base" role="alert">
                {language.t("settings.account.logout.error")}
              </p>
            </Show>
          </section>
        </Show>

        <Show when={!signedIn()}>
          <section class="settings-section" aria-label={language.t("settings.account.device.title")}>
            <SettingsList>
              <SettingsRow
                title={language.t("settings.account.device.title")}
                description={language.t("settings.account.device.description")}
              >
                <Show
                  when={device.phase === "waiting" || device.phase === "starting"}
                  fallback={
                    <Button variant="neutral" onClick={startLogin}>
                      {language.t("settings.account.device.start")}
                    </Button>
                  }
                >
                  <Button variant="ghost" onClick={cancelLogin}>
                    {language.t("settings.account.device.cancel")}
                  </Button>
                </Show>
              </SettingsRow>
              <Show when={device.phase === "starting"}>
                <SettingsRow
                  title={language.t("settings.account.device.starting")}
                  description={language.t("settings.account.device.starting.description")}
                >
                  <span />
                </SettingsRow>
              </Show>
              <Show when={waitingStart()}>
                {(start) => (
                  <div class="flex flex-col gap-3 px-4 py-3">
                    <span class="text-11-regular text-v2-text-text-muted">
                      {language.t("settings.account.device.codeHint")}
                    </span>
                    <div class="flex flex-wrap items-center gap-2">
                      <code class="rounded-[6px] bg-v2-background-bg-layer-02 px-3 py-2 font-mono text-[15px] font-[600] tracking-[0.18em] text-v2-text-text-base">
                        {start().userCode}
                      </code>
                      <Button variant="neutral" size="small" onClick={copyCode}>
                        {language.t(copied() ? "common.copied" : "settings.account.device.copyCode")}
                      </Button>
                      <Button variant="neutral" size="small" onClick={openVerification}>
                        {language.t("settings.account.device.openBrowser")}
                      </Button>
                    </div>
                    <span class="text-11-regular text-v2-text-text-muted">
                      {language.t("settings.account.device.waiting")}
                    </span>
                  </div>
                )}
              </Show>
            </SettingsList>
            <Show when={device.phase === "error"}>
              <p class="text-text-danger-base" role="alert">
                {language.t(
                  device.error === "expired"
                    ? "settings.account.device.expired"
                    : "settings.account.device.startError",
                )}
              </p>
            </Show>
          </section>

          <section class="settings-section" aria-label={language.t("settings.account.apiKey.title")}>
            <SettingsList>
              <div class="flex flex-col gap-3 px-4 py-3">
                <div class="flex flex-col gap-1">
                  <span class="text-[13px] font-[530] leading-4 text-v2-text-text-base">
                    {language.t("settings.account.apiKey.title")}
                  </span>
                  <span class="text-11-regular text-v2-text-text-muted">
                    {language.t("settings.account.apiKey.description")}
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <TextInput
                    type="password"
                    class="!w-full max-w-[320px]"
                    placeholder={language.t("settings.account.apiKey.placeholder")}
                    value={apiKey()}
                    invalid={keyError() !== undefined}
                    autocomplete="off"
                    spellcheck={false}
                    aria-label={language.t("settings.account.apiKey.title")}
                    onInput={(event) => {
                      setApiKey(event.currentTarget.value)
                      setKeyError(undefined)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitKey()
                    }}
                  />
                  <Button variant="neutral" disabled={!apiKey().trim() || saveKey.isPending} onClick={submitKey}>
                    {language.t("settings.account.apiKey.save")}
                  </Button>
                </div>
                <Show when={keyError()}>
                  <p class="-mt-1 text-text-danger-base" role="alert">
                    {language.t(
                      keyError() === "invalid"
                        ? "settings.account.apiKey.invalid"
                        : "settings.account.apiKey.failed",
                    )}
                  </p>
                </Show>
              </div>
            </SettingsList>
          </section>
        </Show>
      </div>
    </>
  )
}
