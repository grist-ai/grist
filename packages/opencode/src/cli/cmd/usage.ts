import { Effect } from "effect"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { loadInviteConfig } from "@/grist/invite/config"

export const UsageCommand = effectCmd({
  command: "usage",
  describe: "show remaining invite spend (gateway)",
  instance: false,
  handler: Effect.fn("Cli.usage")(function* () {
    const config = loadInviteConfig()
    if (!config) {
      return yield* fail("Grist needs you signed in. Run `grist auth login --gateway <url>`.")
    }
    const { fetchUsage } = yield* Effect.promise(() => import("@/grist/invite/client"))
    const usage = yield* Effect.tryPromise({
      try: () => fetchUsage(config),
      catch: (error) => new CliError({ message: error instanceof Error ? error.message : String(error) }),
    })
    UI.println(
      UI.Style.TEXT_NORMAL_BOLD +
        "Grist usage" +
        UI.Style.TEXT_NORMAL +
        ` · $${usage.spent_usd.toFixed(2)} / $${usage.cap_usd.toFixed(2)} · $${usage.remaining_usd.toFixed(2)} left`,
    )
    UI.println(`  cheapest  $${usage.by_rung.cheapest.toFixed(2)}`)
    UI.println(`  medium    $${usage.by_rung.medium.toFixed(2)}`)
    UI.println(`  frontier  $${usage.by_rung.frontier.toFixed(2)}`)
  }),
})
