import fs from "node:fs"
import {
  canonicalApiKey,
  DEFAULT_GATEWAY_URL,
  inviteConfigPath,
  loadInviteConfig,
  pollCliLogin,
  startCliLogin,
  writeInviteConfig,
} from "@grist-ai/logic"
import { Effect } from "effect"
import { GristAuthRpcs } from "../../shared/ipc-rpc"

// The desktop writes the exact credential file the CLI reads
// (`~/.grist/config.json` via writeInviteConfig), so the bundled grist-cli the
// desktop spawns picks up the same auth with no extra wiring. The credential
// itself never crosses into the renderer — status reports kind/gateway only.
// Error values are machine-readable codes the renderer maps to i18n copy.

const gatewayUrl = () => loadInviteConfig()?.gatewayUrl ?? DEFAULT_GATEWAY_URL

function clearInviteCode() {
  const file = inviteConfigPath()
  if (!fs.existsSync(file)) return
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
  delete raw.code
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n")
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // non-POSIX filesystems: best effort
  }
}

export const gristAuthHandlers = GristAuthRpcs.toLayer(
  GristAuthRpcs.of({
    GristAuthStatus: () =>
      Effect.sync(() => {
        const config = loadInviteConfig()
        return {
          signedIn: !!config,
          kind: config?.kind ?? null,
          gatewayUrl: config?.gatewayUrl ?? null,
        }
      }),
    GristAuthStartDevice: () =>
      Effect.tryPromise({
        try: async () => {
          const url = gatewayUrl()
          const started = await startCliLogin(url)
          return {
            deviceCode: started.device_code,
            userCode: started.user_code,
            verificationUri: started.verification_uri.startsWith("http")
              ? started.verification_uri
              : `${url.replace(/\/+$/, "")}${started.verification_uri}`,
            interval: started.interval,
            expiresIn: started.expires_in,
          }
        },
        catch: () => "unreachable" as const,
      }),
    GristAuthPollDevice: ({ deviceCode }) =>
      Effect.tryPromise({
        try: async () => {
          const url = gatewayUrl()
          const status = await pollCliLogin(url, deviceCode)
          if (status.status === "approved") writeInviteConfig({ code: status.code, gatewayUrl: url })
          return { status: status.status }
        },
        // A dropped poll surfaces as a failure; the renderer treats any poll
        // failure as still-pending and keeps waiting.
        catch: () => "unreachable" as const,
      }),
    GristAuthSaveApiKey: ({ apiKey }) => {
      const key = canonicalApiKey(apiKey)
      return key
        ? Effect.asVoid(
            Effect.try({
              try: () => writeInviteConfig({ code: key, gatewayUrl: gatewayUrl() }),
              catch: () => "write-failed" as const,
            }),
          )
        : Effect.fail("invalid-key" as const)
    },
    GristAuthLogout: () =>
      Effect.try({
        try: () => clearInviteCode(),
        catch: () => "write-failed" as const,
      }),
  }),
)
