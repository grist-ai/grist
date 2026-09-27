import { homedir } from "node:os"
import path from "node:path"
import { app } from "electron"

// Where the v2 CLI this desktop spawns registers its background service.
//
// This must match packages/cli/src/services/service-config.ts exactly: the CLI
// writes its registration to <state>/grist/<channel-aware name>, where <state>
// is XDG_STATE_HOME (or ~/.local/state) and the file name depends on the
// channel baked into the CLI at build time. The desktop cannot rely on the
// client's default registration file here because that default still points at
// the pre-rebrand "opencode" state directory, so a spawned server would never
// be discovered and every launch would time out waiting for it.
export function cliRegistrationFile(): string {
  const isolated = !app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1"
  if (isolated) {
    // BackgroundService.connect() points the isolated CLI at the app's userData
    // via XDG_STATE_HOME; the dev CLI's baked channel is "local".
    return path.join(app.getPath("userData"), "grist", "service-local.json")
  }
  const state = process.env["XDG_STATE_HOME"] ?? path.join(homedir(), ".local", "state")
  return path.join(state, "grist", registrationFilename(bundledCliChannel()))
}

// The channel baked into the CLI the desktop spawns. Packaged apps bundle the
// npm CLI builds, whose publish workflow only offers the latest/beta/next
// dist-tags; dev runs the CLI from source, where the channel defaults to
// "local" (see packages/cli/src/version.ts).
function bundledCliChannel(): string {
  return app.isPackaged ? "latest" : "local"
}

// Mirrors ServiceConfig.filename() in packages/cli/src/services/service-config.ts.
function registrationFilename(channel: string): string {
  if (channel === "latest" || channel === "dev" || channel === "beta" || channel === "next") return "service.json"
  return `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}
