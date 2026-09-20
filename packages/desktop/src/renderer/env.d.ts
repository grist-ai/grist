import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __GRIST__?: {
      deepLinks?: string[]
    }
    /** @deprecated alias for __GRIST__ during migration */
    __OPENCODE__?: {
      deepLinks?: string[]
    }
  }
}
