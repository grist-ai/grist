import { intro, log, outro, spinner } from "@clack/prompts"
import { Effect } from "effect"
import {
  canonicalApiKey,
  DEFAULT_GATEWAY_URL,
  pollCliLogin,
  startCliLogin,
  writeInviteConfig,
} from "@grist-ai/logic"
import { openUrl } from "../../../ui/prompt"

export type DeviceStart = typeof startCliLogin
export type DevicePoll = typeof pollCliLogin

/**
 * `grist auth login --provider grist` — the CLI side of the gateway's device-code
 * flow (documented on the gateway's own sign-in page). Either takes a pasted
 * dashboard API key (--api-key) or starts a device login: the user approves it in
 * the browser and the terminal polls until the site returns their credential.
 */
export const gristLogin = Effect.fn("cli.auth.login.grist")(function* (input: {
  provider: string
  apiKey?: string
  gatewayUrl?: string
  start?: DeviceStart
  poll?: DevicePoll
}) {
  if (input.provider.toLowerCase() !== "grist")
    return yield* Effect.fail(new Error(`Unknown provider "${input.provider}". Available: grist`))
  const gatewayUrl = (input.gatewayUrl ?? process.env.GRIST_GATEWAY_URL ?? "").trim() || DEFAULT_GATEWAY_URL
  intro("Log in to Grist")

  if (input.apiKey) {
    const key = canonicalApiKey(input.apiKey)
    if (!key)
      return yield* Effect.fail(
        new Error("That doesn't look like a Grist API key (expected grist_sk_… from the dashboard)"),
      )
    const file = writeInviteConfig({ code: key, gatewayUrl })
    outro(`Signed in — API key saved to ${file}`)
    return
  }

  yield* gristDeviceLogin({
    gatewayUrl,
    start: input.start ?? startCliLogin,
    poll: input.poll ?? pollCliLogin,
  })
  outro("Signed in")
})

export const gristDeviceLogin = Effect.fn("cli.auth.login.grist-device")(function* (input: {
  gatewayUrl: string
  start?: DeviceStart
  poll?: DevicePoll
}) {
  const start = input.start ?? startCliLogin
  const poll = input.poll ?? pollCliLogin
  const started = yield* Effect.tryPromise({
    try: () => start(input.gatewayUrl),
    catch: (cause) => new Error(`Couldn't reach the gateway at ${input.gatewayUrl}: ${describeCause(cause)}`),
  })
  const url = started.verification_uri.startsWith("http")
    ? started.verification_uri
    : `${input.gatewayUrl.replace(/\/+$/, "")}${started.verification_uri}`
  log.info("Approve this terminal in your browser:")
  log.info(url)
  log.info(`Enter code: ${started.user_code}`)
  if (process.stdin.isTTY && process.stdout.isTTY) yield* openUrl(url)

  const waiting = spinner()
  waiting.start("Waiting for approval…")
  const deadline = Date.now() + started.expires_in * 1000
  while (Date.now() < deadline) {
    yield* Effect.sleep(`${Math.max(1, started.interval)} seconds`)
    const status = yield* Effect.tryPromise({
      try: () => poll(input.gatewayUrl, started.device_code),
      // A dropped poll is not a denial — keep waiting.
      catch: () => ({ status: "pending" as const }),
    }).pipe(Effect.orDie)
    if (status.status === "approved") {
      const file = writeInviteConfig({ code: status.code, gatewayUrl: input.gatewayUrl })
      waiting.stop("Approved")
      log.info(`Grist credential saved to ${file}`)
      return
    }
    if (status.status === "expired") break
  }
  waiting.stop("Login expired", 1)
  return yield* Effect.fail(new Error("The login code expired. Run grist auth login --provider grist again."))
})

function describeCause(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
