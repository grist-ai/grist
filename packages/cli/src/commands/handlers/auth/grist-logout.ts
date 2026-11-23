import { Effect } from "effect"
import {
  canonicalApiKey,
  canonicalInviteCode,
  loadInviteConfig,
  removeInviteConfig,
  type InviteConfig,
} from "@grist-ai/logic"
import { gristMethod, type GristMethod } from "./grist-status"

export interface GristLogoutResult {
  outcome: "removed" | "not-signed-in" | "env-credential"
  method?: GristMethod
  gatewayUrl?: string
  fileCleared: boolean
}

/**
 * `grist auth logout grist` — removes the Grist credential that
 * `grist auth login --provider grist` stored in the invite config file.
 * A credential supplied through GRIST_API_KEY / GRIST_INVITE lives in the
 * environment, not the file, so it survives file removal and is reported
 * instead of silently leaving the user signed in.
 */
export const gristLogout = Effect.fn("cli.auth.logout.grist")(function* (input: {
  load?: () => InviteConfig | undefined
  remove?: () => boolean
}) {
  const config = (input.load ?? loadInviteConfig)()
  if (!config) return { outcome: "not-signed-in", fileCleared: false } as GristLogoutResult
  const base = { method: gristMethod(config), gatewayUrl: config.gatewayUrl }
  const fileCleared = (input.remove ?? removeInviteConfig)()
  if (envCredential()) return { outcome: "env-credential", ...base, fileCleared }
  if (!fileCleared) return { outcome: "not-signed-in", ...base, fileCleared }
  return { outcome: "removed", ...base, fileCleared }
})

function envCredential() {
  return Boolean(
    canonicalApiKey(process.env.GRIST_API_KEY ?? "") ?? canonicalInviteCode(process.env.GRIST_INVITE ?? ""),
  )
}
