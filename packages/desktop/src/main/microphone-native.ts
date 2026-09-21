import { shell, systemPreferences } from "electron"
import { MICROPHONE_SETTINGS_URL, ensureMicrophoneAccess } from "./microphone"

export function ensureMicrophoneAccessNative() {
  if (process.platform !== "darwin") return Promise.resolve(true)
  return ensureMicrophoneAccess({
    status: systemPreferences.getMediaAccessStatus("microphone"),
    ask: () => systemPreferences.askForMediaAccess("microphone"),
    openSettings: () => {
      void shell.openExternal(MICROPHONE_SETTINGS_URL)
    },
  })
}
