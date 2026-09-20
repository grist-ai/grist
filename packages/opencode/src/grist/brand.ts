/** User-facing product brand (packages stay OpenCode until a deliberate rename). */
export const PRODUCT_NAME = "Grist"
export const PRODUCT_NAME_LOWER = "grist"
export const PRODUCT_TAGLINE = "confidence-gated coding agent"

/** Gate picks models; users never select or see them. */
export const HIDE_MODEL_UI = true

/** CLI / TUI wordmark rows (same glyph dialect as upstream: _ ^ ~ ,). */
export const WORDMARK = [
  "                  ",
  "█▀▀▀ █▀▀█ █ █▀▀▀ ▀█▀",
  "█_^█ █^^█ █ ▀▀▀█ _█_",
  "▀▀▀▀ ▀__▀ ▀ ▀▀▀▀ _▀_",
] as const

export const LOGO = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["             ", "█▀▀█ █ █▀▀▀ ▀█▀", "█^^█ █ ▀▀▀█ _█_", "▀__▀ ▀ ▀▀▀▀ _▀_"],
} as const
