import { Effect } from "effect"
import path from "path"
import { CliError, effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import { scaffoldGrist } from "@/grist/init/scaffold"
import { bootstrapCodebase } from "@/grist/init/bootstrap"

type Args = {
  directory?: string
  since?: string
  limit?: number
  "skip-graph"?: boolean
  "skip-init"?: boolean
}

export const BootstrapCommand = effectCmd({
  command: "bootstrap [directory]",
  describe: "cold-start a codebase: pin SHA, optional Graphify map, ownership mine",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("directory", {
        describe: "repo root (default: cwd)",
        type: "string",
      })
      .option("since", {
        describe: "git history window (default: 18months)",
        type: "string",
      })
      .option("limit", {
        describe: "max ownership rows (default: 5000)",
        type: "number",
      })
      .option("skip-graph", {
        describe: "skip Graphify even if installed",
        type: "boolean",
      })
      .option("skip-init", {
        describe: "do not scaffold .grist/ before mining",
        type: "boolean",
      }),
  directory: (args) => path.resolve(args.directory || process.cwd()),
  handler: Effect.fn("Cli.bootstrap")(function* (args) {
    const cwd = path.resolve(args.directory || process.cwd())

    if (!args["skip-init"]) {
      const scaffold = scaffoldGrist({ cwd })
      if (scaffold.created.length) {
        UI.println(UI.Style.TEXT_DIM + "scaffolded: " + scaffold.created.join(", ") + UI.Style.TEXT_NORMAL)
      }
    }

    const boot = yield* Effect.tryPromise({
      try: () =>
        bootstrapCodebase({
          cwd,
          since: args.since,
          limit: args.limit,
          skipGraph: Boolean(args["skip-graph"]),
        }),
      catch: (error) =>
        new CliError({ message: error instanceof Error ? error.message : String(error) }),
    })

    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Grist bootstrap" + UI.Style.TEXT_NORMAL + ` · ${boot.directory}`)
    UI.println(`  pinned   ${boot.sha}`)
    UI.println(`  mined    ${boot.ownershipRows} ownership rows`)
    UI.println(`  wrote    ${boot.ownershipPath}`)
    if (boot.graphPath) UI.println(`  map      ${boot.graphPath}`)
    for (const note of boot.notes) {
      UI.println(UI.Style.TEXT_DIM + "  · " + note + UI.Style.TEXT_NORMAL)
    }
    UI.println(`  next     ${boot.nextPath}`)
    UI.println("")
    UI.println(
      UI.Style.TEXT_WARNING +
        "Review ownership rows before memory remember — never auto-persist unreviewed facts." +
        UI.Style.TEXT_NORMAL,
    )
  }),
})
