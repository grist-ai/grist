import { Effect } from "effect"
import { CliError, effectCmd } from "../effect-cmd"

export const GatewayCommand = effectCmd({
  command: "gateway",
  describe: "run the invite-gated inference gateway (founder infra)",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("port", {
        describe: "listen port (default PORT or 8787)",
        type: "number",
      })
      .option("hostname", {
        describe: "listen hostname (default 0.0.0.0)",
        type: "string",
      })
      .option("db", {
        describe: "sqlite path (default GRIST_GATEWAY_DB or ./grist-gateway.sqlite)",
        type: "string",
      }),
  handler: Effect.fn("Cli.gateway")(function* (args) {
    const { listenGateway } = yield* Effect.promise(() => import("../../grist/gateway/server"))
    yield* Effect.tryPromise({
      try: () =>
        listenGateway({
          port: args.port,
          hostname: args.hostname,
          dbPath: args.db,
        }),
      catch: (error) =>
        new CliError({ message: error instanceof Error ? error.message : String(error) }),
    })
    yield* Effect.never
  }),
})
