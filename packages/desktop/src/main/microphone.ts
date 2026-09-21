export const MICROPHONE_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"

export function ensureMicrophoneAccess(input: {
  status: string
  ask: () => Promise<boolean>
  openSettings: () => void
}) {
  if (input.status === "granted") return Promise.resolve(true)
  if (input.status === "denied" || input.status === "restricted") {
    input.openSettings()
    return Promise.resolve(false)
  }
  return input.ask()
}
