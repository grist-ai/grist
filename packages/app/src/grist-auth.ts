// Grist account auth surface the desktop platform exposes to the app. The
// credential itself is written by the desktop main process straight into the
// shared CLI credential file (~/.grist/config.json); these types only carry
// status and the device-flow handshake, never the key.

export type GristAuthKind = "invite" | "api_key"

export type GristAuthStatus = {
  signedIn: boolean
  kind: GristAuthKind | null
  gatewayUrl: string | null
}

export type GristAuthDeviceStart = {
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
  expiresIn: number
}

export type GristAuthPollStatus = "pending" | "approved" | "expired"

export type GristAuthPlatform = {
  status(): Promise<GristAuthStatus>
  startDevice(): Promise<GristAuthDeviceStart>
  pollDevice(deviceCode: string): Promise<{ status: GristAuthPollStatus }>
  saveApiKey(apiKey: string): Promise<void>
  logout(): Promise<void>
}
