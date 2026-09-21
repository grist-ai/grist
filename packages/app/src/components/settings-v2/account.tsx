import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Show, createMemo, createResource, createSignal, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { PRODUCT_COLOR } from "@/product"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

function usd(value: number) {
  return `$${value.toFixed(2)}`
}

export const SettingsAccountV2: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const account = () => platform.account
  const [status] = createResource(() => account()?.status())
  const [usage, usageActions] = createResource(
    () => (status()?.signedIn ? true : undefined),
    () => {
      const api = account()
      if (!api) return Promise.reject(new Error("signed-out"))
      return api.usage()
    },
  )
  const [message, setMessage] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const signedIn = createMemo(() => !!status()?.signedIn)
  const pct = createMemo(() => {
    const data = usage()
    if (!data?.cap_usd) return 0
    return Math.min(100, (data.spent_usd / data.cap_usd) * 100)
  })

  async function signIn() {
    const api = account()
    if (!api || busy()) return
    setBusy(true)
    setMessage(language.t("settings.account.waiting"))
    try {
      await api.startLogin()
      const result = await api.waitLogin()
      if (!result.ok) {
      if (result.reason === "expired") {
        setMessage(language.t("settings.account.error.expired"))
        setBusy(false)
        return
      }
      if (result.reason === "unreachable") {
        setMessage(language.t("settings.account.error.unreachable"))
        setBusy(false)
        return
      }
      setBusy(false)
      return
    }
      await platform.restart()
    } catch {
      setMessage(language.t("settings.account.error.unreachable"))
      setBusy(false)
    }
  }

  async function signOut() {
    const api = account()
    if (!api || busy()) return
    setBusy(true)
    await api.logout()
    await platform.restart()
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.account.title")}</h2>
      </div>
      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.account.title")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={signedIn() ? language.t("settings.account.signedIn") : language.t("settings.account.signedOut")}
              description={message() ?? language.t("login.body")}
            >
              <Show
                when={signedIn()}
                fallback={
                  <ButtonV2 variant="contrast" disabled={busy()} onClick={() => void signIn()}>
                    {language.t("settings.account.signIn")}
                  </ButtonV2>
                }
              >
                <ButtonV2 variant="ghost" disabled={busy()} onClick={() => void signOut()}>
                  {language.t("settings.account.signOut")}
                </ButtonV2>
              </Show>
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <Show when={usage()}>
          {(data) => (
            <>
              <div class="settings-v2-section">
                <h3 class="settings-v2-section-title">{language.t("settings.account.usage.title")}</h3>
                <SettingsListV2>
                  <SettingsRowV2
                    title={language.t("settings.account.usage.description", {
                      spent: usd(data().spent_usd),
                      cap: usd(data().cap_usd),
                      remaining: usd(data().remaining_usd),
                    })}
                    description={
                      data().expires_at
                        ? language.t("settings.account.expires", {
                            date: new Date(data().expires_at).toLocaleDateString(),
                          })
                        : language.t("settings.account.usage.title")
                    }
                  >
                    <div class="settings-v2-usage-bar" aria-hidden="true">
                      <span style={{ width: `${pct()}%`, "background-color": PRODUCT_COLOR }} />
                    </div>
                  </SettingsRowV2>
                  <SettingsRowV2
                    title={language.t("settings.account.usage.cheapest")}
                    description={usd(data().by_rung.cheapest)}
                  >
                    <span />
                  </SettingsRowV2>
                  <SettingsRowV2
                    title={language.t("settings.account.usage.medium")}
                    description={usd(data().by_rung.medium)}
                  >
                    <span />
                  </SettingsRowV2>
                  <SettingsRowV2
                    title={language.t("settings.account.usage.frontier")}
                    description={usd(data().by_rung.frontier)}
                  >
                    <span />
                  </SettingsRowV2>
                </SettingsListV2>
              </div>

              <div class="settings-v2-section">
                <h3 class="settings-v2-section-title">{language.t("settings.account.plan.title")}</h3>
                <SettingsListV2>
                  <SettingsRowV2
                    title={data().plan === "beta" ? language.t("settings.account.plan.beta") : data().plan}
                    description={language.t("settings.account.plan.description")}
                  >
                    <ButtonV2
                      variant="outline"
                      onClick={() => {
                        account()?.openPlans()
                        void usageActions.refetch()
                      }}
                    >
                      {language.t("settings.account.plan.manage")}
                    </ButtonV2>
                  </SettingsRowV2>
                </SettingsListV2>
              </div>
            </>
          )}
        </Show>
      </div>
    </>
  )
}
