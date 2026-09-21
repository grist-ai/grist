import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Splash } from "@opencode-ai/ui/logo"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { PRODUCT_COLOR } from "@/product"

export function GristLoginScreen() {
  const language = useLanguage()
  const platform = usePlatform()
  const [userCode, setUserCode] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)

  async function signIn() {
    const account = platform.account
    if (!account || busy()) return
    setBusy(true)
    setError()
    try {
      const start = await account.startLogin()
      setUserCode(start.userCode)
      const result = await account.waitLogin()
      if (result.ok) {
        await platform.restart()
        return
      }
      if (result.reason === "expired") {
        setError(language.t("settings.account.error.expired"))
      }
      if (result.reason === "unreachable") {
        setError(language.t("settings.account.error.unreachable"))
      }
    } catch {
      setError(language.t("settings.account.error.unreachable"))
    }
    setUserCode()
    setBusy(false)
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base gap-8 p-8">
      <div style={{ color: PRODUCT_COLOR }}>
        <Splash class="w-40 h-11" />
      </div>
      <div class="flex flex-col items-center gap-2 max-w-sm text-center">
        <h1 class="text-16-medium text-text-strong">{language.t("login.title")}</h1>
        <p class="text-13-regular text-text-weak">{language.t("login.body")}</p>
        <Show when={userCode()}>
          {(code) => (
            <p class="text-13-regular text-text-base">
              {language.t("login.waiting")}
              <span class="block mt-1 text-text-strong font-medium">{language.t("login.code", { code: code() })}</span>
            </p>
          )}
        </Show>
        <Show when={error()}>{(message) => <p class="text-13-regular text-text-danger-base">{message()}</p>}</Show>
      </div>
      <ButtonV2 variant="contrast" size="large" disabled={busy()} onClick={() => void signIn()}>
        {busy() ? language.t("login.waiting") : language.t("login.action")}
      </ButtonV2>
    </div>
  )
}
