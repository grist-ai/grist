#!/usr/bin/env bun
/**
 * Builds the `grist` binary.
 *
 * The grist binary is the v2 CLI compiled to a single executable with the
 * grist plugin baked in (GRIST_BINARY define → registered as an always-on
 * instance plugin in packages/cli/src/index.ts). Every `grist run` therefore
 * loads the Jev gate, doctrine, and control-plane hooks with no user config.
 *
 * Headless-focused: skips the web-UI embed (v1's --skip-embed-web-ui); the
 * TUI still builds because it shares the entrypoint.
 *
 * Usage: bun run script/build.ts [--outdir=<dir>] [--target=<bun-target>]
 */
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import type { BunPlugin } from "bun"
import { resolveOpencodePty } from "../../cli/script/opencode-pty"
import pkg from "../package.json"

const root = path.resolve(import.meta.dirname, "..", "..", "..")
const outdir = path.resolve(
  root,
  process.argv.find((arg) => arg.startsWith("--outdir="))?.slice("--outdir=".length) ?? "packages/grist/dist",
)
const requestedTarget = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
process.chdir(root)

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const platform = process.platform === "win32" ? "windows" : process.platform
const arch = process.arch === "arm64" ? "aarch64" : process.arch
const target = (requestedTarget ?? `bun-${platform}-${arch}`) as Bun.Build.CompileTarget

const version = process.env.GRIST_VERSION ?? pkg.version
const channel = process.env.GRIST_CHANNEL ?? "local"

// Headless build: the web-UI asset archive is only needed for `serve`'s
// browser UI. Stub the virtual module instead of building the web app.
const appAssetsStub: BunPlugin = {
  name: "grist-app-assets-stub",
  setup(build) {
    build.onResolve({ filter: /^virtual:opencode-app-assets$/ }, () => ({
      path: "grist-app-assets-stub",
      namespace: "grist",
    }))
    build.onLoad({ filter: /^grist-app-assets-stub$/, namespace: "grist" }, () => ({
      loader: "js",
      contents: "export default undefined",
    }))
  },
}

console.log(`building grist ${version} (${channel}) for ${target}`)

// Embed the platform pty binary the same way the main CLI build does, so
// the compiled binary doesn't need @opencode-ai/pty-<platform> at runtime.
const opencodePty = await resolveOpencodePty({
  platform: process.platform,
  arch: process.arch,
  ...(process.platform === "linux" ? { libc: "glibc" as const } : {}),
})
const opencodePtyPlugin: BunPlugin = {
  name: "opencode-pty-binary",
  setup(build) {
    build.onLoad({ filter: /persistent-pty[/\\]pty-binding\.ts$/ }, () => ({
      loader: "js",
      contents: opencodePty
        ? `import file from ${JSON.stringify(opencodePty.source)} with { type: "file" }\nexport default { path: file, version: ${JSON.stringify(opencodePty.version)}, sha256: ${JSON.stringify(opencodePty.sha256)} }`
        : "export default undefined",
    }))
  },
}

const result = await Bun.build({
  entrypoints: ["./packages/cli/src/index.ts"],
  tsconfig: "./packages/cli/tsconfig.json",
  plugins: [appAssetsStub, createSolidTransformPlugin(), opencodePtyPlugin],
  external: ["node-gyp"],
  format: "esm",
  minify: true,
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target,
    outfile: path.join(outdir, "grist"),
    execArgv: ["--smol", `--user-agent=grist/${channel}/${version}/cli`, "--use-system-ca", "--no-warnings", "--"],
    ...(platform === "windows" ? { windows: {} } : {}),
  },
  define: {
    GRIST_BINARY: "true",
    OPENCODE_VERSION: JSON.stringify(version),
    OPENCODE_CLI_NAME: "'grist'",
    OPENCODE_CHANNEL: JSON.stringify(channel),
    OPENCODE_ARTIFACT: "'cli'",
    ...(platform === "linux"
      ? {
          OPENCODE_LIBC: "'glibc'",
          FFF_LIBC: "'gnu'",
          "process.env.OPENTUI_LIBC": JSON.stringify("glibc"),
        }
      : {}),
  },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`wrote ${path.join(outdir, "grist")}`)
