/** User-facing Grist desktop identity (npm packages stay @opencode-ai/*). */
export const PRODUCT_NAME = "Grist"
export const PRODUCT_NAME_LOWER = "grist"
export const PRODUCT_COLOR = "#EC5B2B"
export const PRODUCT_GATEWAY_URL = "https://grist.lol"
/** Bump this before each signed desktop release so installed apps see an update. */
export const PRODUCT_VERSION = "0.1.9"
/** Public GitHub repo that hosts DMG/zip + latest-mac.yml for electron-updater. */
export const UPDATES = {
  owner: "pranav6226",
  repo: "grist-downloads",
} as const

export const APP_NAMES = {
  dev: "Grist Dev",
  beta: "Grist Beta",
  prod: "Grist",
} as const

export const APP_IDS = {
  dev: "ai.grist.desktop.dev",
  beta: "ai.grist.desktop.beta",
  prod: "ai.grist.desktop",
} as const

export const PROTOCOL_SCHEME = "grist"
