import { Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/v2/dialog-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import "./settings-v2.css"
import { SettingsAccountV2 } from "./account"

export const DialogSettings: Component<{
  sessionID?: string
  defaultValue?: string
}> = () => {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <Dialog size="x-large" variant="settings" class="settings-v2-dialog">
      <TabsV2 orientation="vertical" variant="settings" value="account" class="settings-v2">
        <TabsV2.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full">
              <div class="flex flex-col gap-1.5">
                <TabsV2.SectionTitle>{language.t("settings.section.account")}</TabsV2.SectionTitle>
                <div class="flex flex-col gap-1.5 w-full">
                  <TabsV2.Trigger value="account">
                    <Icon name="shield" />
                    {language.t("settings.tab.account")}
                  </TabsV2.Trigger>
                </div>
              </div>
            </div>
            <div class="settings-v2-nav-footer">
              <span>{language.t("app.name.desktop")}</span>
              <span>v{platform.version}</span>
            </div>
          </div>
        </TabsV2.List>
        <TabsV2.Content value="account" class="settings-v2-panel">
          <SettingsAccountV2 />
        </TabsV2.Content>
      </TabsV2>
    </Dialog>
  )
}
