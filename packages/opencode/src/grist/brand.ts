/** User-facing product brand (packages stay OpenCode until a deliberate rename). */
export const PRODUCT_NAME = "Grist"
export const PRODUCT_NAME_LOWER = "grist"
export const PRODUCT_TAGLINE = "confidence-gated coding agent"
/** Brand orange used by TUI/CLI themes and highlights. */
export const PRODUCT_COLOR = "#EC5B2B"

/** Gate picks models; users never select or see them. */
export const HIDE_MODEL_UI = true

/** CLI / TUI wordmark rows. Same 5-row pixel geometry as the desktop wordmark. */
export const WORDMARK = [
  "████  ███  █  ████  ██████",
  "█     █    █  █       ██  ",
  "█ ██  █ █  █  ████    ██  ",
  "█     █ █  █     █    ██  ",
  "████  █ █  █  ████    ██  ",
] as const

export const LOGO = {
  left: ["████  ███", "█     █  ", "█ ██  █ █", "█     █ █", "████  █ █"],
  right: [" █  ████  ██████", " █  █       ██  ", " █  ████    ██  ", " █     █    ██  ", " █  ████    ██  "],
} as const
