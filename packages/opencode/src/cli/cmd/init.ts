import { Effect } from "effect"
import path from "path"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { scaffoldGrist } from "@/grist/init/scaffold"
import { bootstrapCodebase } from "@/grist/init/bootstrap"

type Args = {
  directory?: string
  force?: boolean
  bootstrap?: boolean
  since?: string
  "skip-graph"?: boolean
  invite?: string
  gateway?: string
}

export const InitCommand = effectCmd({
  command: "init [directory]",
  describe: "scaffold Grist for a codebase (.grist/, config, gitignore)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("directory", {
        describe: "repo root (default: cwd)",
        type: "string",
      })
      .option("force", {
        alias: "f",
        describe: "overwrite existing .grist/README.md",
        type: "boolean",
      })
      .option("bootstrap", {
        describe: "also run cold-start ownership mine / optional code map",
        type: "boolean",
      })
      .option("since", {
        describe: "ownership history window when using --bootstrap (default: 18months)",
        type: "string",
      })
      .option("skip-graph", {
        describe: "with --bootstrap, skip Graphify even if installed",
        type: "boolean",
      })
      .option("invite", {
        describe: "invite code (grist-XXXX-XXXX) for the public test gateway",
        type: "string",
      })
      .option("gateway", {
        describe: "gateway URL (default GRIST_GATEWAY_URL)",
        type: "string",
      }),
  directory: (args) => path.resolve(args.directory || process.cwd()),
  handler: Effect.fn("Cli.init")(function* (args) {
    const cwd = path.resolve(args.directory || process.cwd())
    const result = scaffoldGrist({ cwd, force: Boolean(args.force) })

    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Grist init" + UI.Style.TEXT_NORMAL + ` · ${result.directory}`)
    for (const item of result.created) {
      UI.println(UI.Style.TEXT_SUCCESS + "  + " + UI.Style.TEXT_NORMAL + item)
    }
    for (const item of result.skipped) {
      UI.println(UI.Style.TEXT_DIM + "  · " + item + " (exists)" + UI.Style.TEXT_NORMAL)
    }
    for (const warning of result.warnings) {
      UI.println(UI.Style.TEXT_WARNING + "  ! " + warning + UI.Style.TEXT_NORMAL)
    }

    if (args.invite) {
      const gatewayUrl = args.gateway?.trim() || process.env.GRIST_GATEWAY_URL?.trim()
      if (!gatewayUrl) {
        return yield* fail("pass --gateway or set GRIST_GATEWAY_URL")
      }
      const { canonicalInviteCode } = yield* Effect.promise(() => import("@/grist/gateway/codes"))
      const { validateInvite } = yield* Effect.promise(() => import("@/grist/invite/client"))
      const { saveInviteConfig } = yield* Effect.promise(() => import("@/grist/invite/config"))
      const code = canonicalInviteCode(args.invite)
      if (!code) return yield* fail("invite code must look like grist-XXXX-XXXX")
      const check = yield* Effect.tryPromise({
        try: () => validateInvite({ code, gatewayUrl }),
        catch: (error) =>
          new CliError({ message: error instanceof Error ? error.message : String(error) }),
      })
      if (!check.valid) return yield* fail("invite code was not accepted")
      saveInviteConfig({ code, gatewayUrl })
      UI.println("")
      UI.println(
        UI.Style.TEXT_SUCCESS +
          "Invite saved" +
          UI.Style.TEXT_NORMAL +
          ` · remaining $${(check.remaining_usd ?? 0).toFixed(2)} of $${(check.spend_cap_usd ?? 0).toFixed(2)}`,
      )
    }

    if (!args.bootstrap) {
      UI.println("")
      UI.println(
        args.invite
          ? "Next: run " + UI.Style.TEXT_HIGHLIGHT + "grist" + UI.Style.TEXT_NORMAL
          : "Next: " +
              UI.Style.TEXT_HIGHLIGHT +
              "grist auth login --provider grist" +
              UI.Style.TEXT_NORMAL,
      )
      UI.println(
        "Cold-start: " +
          UI.Style.TEXT_HIGHLIGHT +
          "grist bootstrap" +
          UI.Style.TEXT_NORMAL +
          " (or re-run init --bootstrap)",
      )
      return
    }

    const boot = yield* Effect.tryPromise({
      try: () =>
        bootstrapCodebase({
          cwd,
          since: args.since,
          skipGraph: Boolean(args["skip-graph"]),
        }),
      catch: (error) =>
        new CliError({ message: error instanceof Error ? error.message : String(error) }),
    })

    UI.println("")
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Bootstrap" + UI.Style.TEXT_NORMAL + ` · pinned ${boot.sha.slice(0, 12)}`)
    UI.println(`  ownership rows: ${boot.ownershipRows}`)
    UI.println(`  → ${boot.ownershipPath}`)
    if (boot.graphPath) UI.println(`  → ${boot.graphPath}`)
    for (const note of boot.notes) {
      UI.println(UI.Style.TEXT_DIM + "  · " + note + UI.Style.TEXT_NORMAL)
    }
    UI.println(`  next: ${boot.nextPath}`)
  }),
})
