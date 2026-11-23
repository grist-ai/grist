import { intro, outro, spinner } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, requireInteractive } from "../../../ui/prompt"
import { createClient, loadIntegrations, request } from "./shared"
import { chooseCredential, chooseIntegration } from "./account"
import { gristLogout } from "./grist-logout"
import { gristMethodLabel } from "./grist-status"

export default Runtime.handler(
  Commands.commands.auth.commands.logout,
  Effect.fn("cli.auth.logout")((input) =>
    logout({
      target: Option.getOrUndefined(input.target),
      credential: Option.getOrUndefined(input.credential),
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    }).pipe(handlePromptErrors),
  ),
)

const logout = Effect.fn("cli.auth.logout.run")(function* (input: {
  target?: string
  credential?: string
  server?: string
  standalone: boolean
}) {
  if (input.target?.toLowerCase() === "grist") return yield* gristAccountLogout()
  if (!input.target)
    yield* requireInteractive("Pass an integration ID or name when running without an interactive terminal")
  if (!input.credential)
    yield* requireInteractive("Pass a credential ID or label when running without an interactive terminal")
  intro("Log out of an account")
  const client = yield* createClient({ server: input.server, standalone: input.standalone })
  const integrations = yield* loadIntegrations(client)
  const integration = yield* chooseIntegration(integrations, input.target)
  const credentialID = yield* chooseCredential(integration, "log out", input.credential)
  const progress = spinner()
  progress.start("Removing credential...")
  yield* request((signal) => client.credential.remove({ credentialID }, { signal })).pipe(
    Effect.tap(() => Effect.sync(() => progress.stop(`Removed account from ${integration.name}`))),
    Effect.tapCause(() => Effect.sync(() => progress.stop("Failed to remove credential", 1))),
  )
  outro("Done")
})

const gristAccountLogout = Effect.fn("cli.auth.logout.grist.run")(function* () {
  intro("Log out of Grist")
  const result = yield* gristLogout({})
  if (result.outcome === "removed") {
    const label = result.method ? gristMethodLabel(result.method) : "Grist"
    outro(`Signed out — removed the stored ${label} credential for ${result.gatewayUrl}`)
    return
  }
  if (result.outcome === "env-credential") {
    outro(
      result.fileCleared
        ? "Cleared the stored credential, but GRIST_API_KEY / GRIST_INVITE in your environment still signs you in — unset it to finish signing out"
        : "Your Grist credential comes from GRIST_API_KEY / GRIST_INVITE in your environment, not the config file — unset it to sign out",
    )
    return
  }
  outro("Not signed in to Grist — nothing to remove")
})
