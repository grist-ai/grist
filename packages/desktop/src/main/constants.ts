import { app } from "electron"

import { APP_IDS, APP_NAMES } from "../../brand"

type Channel = "local" | "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"
export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"

const appNames: Record<string, string> = {
  dev: APP_NAMES.dev,
  beta: APP_NAMES.beta,
  prod: APP_NAMES.prod,
}
const appIDs: Record<string, string> = {
  dev: APP_IDS.dev,
  beta: APP_IDS.beta,
  prod: APP_IDS.prod,
}
// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : APP_NAMES.dev
export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : APP_IDS.dev
