import { Effect } from "effect"
import { gatewayAuthHeaders, loadInviteConfig, type InviteConfig } from "@grist-ai/logic"

export type GristMethod = "website" | "api_key"

export interface GristSessionDetails {
  email?: string
  userId?: string
}

/** Resolves account identity for a stored credential from the gateway. */
export type SessionLookup = (config: InviteConfig) => Promise<GristSessionDetails | undefined>

export interface GristStatus {
  signedIn: boolean
  method?: GristMethod
  gatewayUrl?: string
  email?: string
  userId?: string
  refreshed: boolean
}

export function gristMethod(config: InviteConfig): GristMethod {
  return config.kind === "api_key" ? "api_key" : "website"
}

export function gristMethodLabel(method: GristMethod): string {
  return method === "api_key" ? "API key" : "website sign-in"
}

/**
 * The gateway's session endpoint (/v1/auth/session) answers only to a Firebase
 * ID token, which the CLI never holds — it stores an invite code or an API key.
 * So the default lookup validates the stored credential with an authenticated
 * usage call and resolves no identity fields; email and user ID appear only
 * when a lookup can resolve them. Any failure (offline, rejected credential)
 * returns undefined so status degrades to the locally stored state.
 */
const gatewaySession: SessionLookup = async (config) => {
  try {
    const response = await fetch(`${config.gatewayUrl}/v1/usage`, {
      headers: gatewayAuthHeaders(config),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return undefined
    return {}
  } catch {
    return undefined
  }
}

/**
 * `grist auth status` — the locally stored Grist sign-in state, refreshed
 * against the gateway when it is reachable. Never exposes the credential.
 */
export const gristStatus = Effect.fn("cli.auth.status")(function* (input: {
  load?: () => InviteConfig | undefined
  session?: SessionLookup
}) {
  const config = (input.load ?? loadInviteConfig)()
  if (!config) return { signedIn: false, refreshed: false } as GristStatus
  const details = yield* Effect.tryPromise({
    try: () => (input.session ?? gatewaySession)(config),
    catch: () => new Error("session lookup failed"),
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const status: GristStatus = {
    signedIn: true,
    method: gristMethod(config),
    gatewayUrl: config.gatewayUrl,
    refreshed: details !== undefined,
  }
  if (details?.email) status.email = details.email
  if (details?.userId) status.userId = details.userId
  return status
})

export function formatGristStatus(status: GristStatus): string {
  if (!status.signedIn || !status.method || !status.gatewayUrl)
    return "Not signed in to Grist — run: grist auth login --provider grist"
  const lines = [
    "Signed in to Grist",
    `  Method: ${gristMethodLabel(status.method)}`,
    `  Gateway: ${status.gatewayUrl}`,
  ]
  if (status.email) lines.push(`  Email: ${status.email}`)
  if (status.userId) lines.push(`  User ID: ${status.userId}`)
  if (!status.refreshed)
    lines.push("  Account details could not be refreshed — showing locally stored state.")
  return lines.join("\n")
}

export function gristStatusJson(status: GristStatus) {
  if (!status.signedIn || !status.method || !status.gatewayUrl) return { signed_in: false }
  return {
    signed_in: true,
    method: status.method,
    gateway_url: status.gatewayUrl,
    ...(status.email ? { email: status.email } : {}),
    ...(status.userId ? { user_id: status.userId } : {}),
    refreshed: status.refreshed,
  }
}
