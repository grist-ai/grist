import { Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsAccountV2 } from "./settings-v2/account"

export const DialogSettings: Component<{ defaultValue?: string }> = () => {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <Dialog size="x-large" transition>
      <Tabs orientation="vertical" variant="settings" value="account" class="h-full settings-dialog">
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full gap-4">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-1.5">
                <Tabs.SectionTitle>{language.t("settings.section.account")}</Tabs.SectionTitle>
                <div class="flex flex-col gap-1.5 w-full">
                  <Tabs.Trigger value="account">
                    <Icon name="shield" />
                    {language.t("settings.tab.account")}
                  </Tabs.Trigger>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.desktop")}</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="account" class="no-scrollbar">
          <SettingsAccountV2 />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
