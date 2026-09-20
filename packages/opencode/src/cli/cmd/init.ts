import { Effect } from "effect"
import path from "path"
import { CliError, effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import { scaffoldGrist } from "@/grist/init/scaffold"
import { bootstrapCodebase } from "@/grist/init/bootstrap"

type Args = {
  directory?: string
  force?: boolean
  bootstrap?: boolean
  since?: string
  "skip-graph"?: boolean
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

    if (!args.bootstrap) {
      UI.println("")
      UI.println(
        "Next: export OPENROUTER_API_KEY=… then run " +
          UI.Style.TEXT_HIGHLIGHT +
          "grist" +
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
