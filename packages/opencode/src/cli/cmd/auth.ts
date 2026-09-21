import { Effect } from "effect"
import readline from "node:readline"
import open from "open"
import { cmd } from "./cmd"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { intro, log, outro } from "../effect/prompt"
import { UI } from "../ui"
import { clearInviteConfig, DEFAULT_GATEWAY_URL, loadInviteConfig, saveInviteConfig } from "@/grist/invite/config"

function strip(url: string) {
  return url.replace(/\/+$/, "")
}

function resolveGateway(arg?: string) {
  return strip(arg?.trim() || process.env.GRIST_GATEWAY_URL?.trim() || loadInviteConfig()?.gatewayUrl || DEFAULT_GATEWAY_URL)
}

export function canPromptLogin() {
  return Boolean(process.stdin.isTTY && (process.stdout.isTTY || process.stderr.isTTY))
}

export async function runAuthLogin(gateway?: string) {
  const gatewayUrl = resolveGateway(gateway)
  if (!gatewayUrl) return { ok: false as const, reason: "unreachable" as const }

  const { startCliLogin, pollCliLogin } = await import("@/grist/invite/client")
  const login = await startCliLogin(gatewayUrl).catch(() => undefined)
  if (!login) return { ok: false as const, reason: "unreachable" as const }

  const url = `${gatewayUrl}${login.verification_uri}`
  UI.println("Opening " + url)
  await open(url).catch(() => undefined)
  UI.println("Waiting for you to log in on the site…")

  const deadline = Date.now() + login.expires_in * 1000
  const interval = Math.max(1, login.interval || 1) * 1000
  while (Date.now() < deadline) {
    await Bun.sleep(interval)
    const next = await pollCliLogin(gatewayUrl, login.device_code).catch(() => undefined)
    if (!next) return { ok: false as const, reason: "unreachable" as const }
    if (next.status === "pending") continue
    if (next.status !== "approved") return { ok: false as const, reason: "expired" as const }
    saveInviteConfig({ code: next.code, gatewayUrl })
    return { ok: true as const }
  }
  return { ok: false as const, reason: "expired" as const }
}

export async function ensureSignedIn(gateway?: string) {
  if (loadInviteConfig()) return true
  if (!canPromptLogin()) return false
  UI.println("First run. Grist needs you signed in.")
  const yes = await promptYes("Open login in your browser?")
  if (!yes) return false
  const result = await runAuthLogin(gateway)
  if (result.ok) {
    UI.println("Logged in")
    return true
  }
  if (result.reason === "expired") UI.error("Login expired. Run grist auth login again.")
  if (result.reason === "unreachable") UI.error("Could not reach the Grist site.")
  return false
}

function promptYes(question: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise<boolean>((resolve) => {
    rl.question(`${question} [Y/n] `, (answer) => {
      rl.close()
      const text = answer.trim().toLowerCase()
      resolve(text === "" || text === "y" || text === "yes")
    })
  })
}

export const AuthLoginCommand = effectCmd({
  command: "login",
  describe: "open the site and log in with your invite",
  instance: false,
  builder: (yargs) =>
    yargs.option("gateway", {
      describe: "site / gateway URL (default GRIST_GATEWAY_URL)",
      type: "string",
    }),
  handler: Effect.fn("Cli.auth.login")(function* (args) {
    UI.empty()
    const gatewayUrl = resolveGateway(args.gateway)
    if (!gatewayUrl) return yield* fail("could not resolve the Grist site")

    yield* intro("Log in")
    yield* log.info("Sign in on the site, then return here.")
    const result = yield* Effect.tryPromise({
      try: () => runAuthLogin(args.gateway),
      catch: (error) =>
        new CliError({
          message: error instanceof Error ? error.message : "could not reach the Grist site",
        }),
    })
    if (!result.ok) {
      if (result.reason === "expired") return yield* fail("Login expired. Run grist auth login again.")
      return yield* fail("could not reach the Grist site")
    }
    yield* outro("You're authenticated. Run grist to start.")
  }),
})

export const AuthLogoutCommand = effectCmd({
  command: "logout",
  describe: "forget the saved invite on this machine",
  instance: false,
  handler: Effect.fn("Cli.auth.logout")(function* () {
    UI.empty()
    if (!loadInviteConfig()) {
      UI.println("Not logged in")
      return
    }
    clearInviteConfig()
    yield* outro("Logged out")
  }),
})

export const AuthCommand = cmd({
  command: "auth",
  describe: "log in to Grist (opens the site)",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .demandCommand(),
  async handler() {},
})
