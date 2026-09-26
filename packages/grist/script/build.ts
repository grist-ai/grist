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
 * Usage:
 *   bun run script/build.ts [--outdir=<dir>] [--target=<bun-target>]
 *     Single binary for the current platform (dev / smoke tests).
 *   bun run script/build.ts --all-targets [--outdir=<dir>]
 *     Every publish target into <outdir>/grist-<os>-<arch>[-musl]/bin/grist,
 *     each with a platform package.json — the layout script/publish.ts stages
 *     for npm. Needs `bun install --os="*" --cpu="*"` first so the pty binary
 *     packages for every platform are present.
 */
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import type { BunPlugin } from "bun"
import { resolveOpencodePty } from "../../cli/script/opencode-pty"
import pkg from "../package.json"

const root = path.resolve(import.meta.dirname, "..", "..", "..")
const allTargetsFlag = process.argv.includes("--all-targets")
const outdir = path.resolve(
  root,
  process.argv.find((arg) => arg.startsWith("--outdir="))?.slice("--outdir=".length) ??
    (allTargetsFlag ? "packages/grist/dist" : "packages/grist/dist"),
)
const requestedTarget = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
process.chdir(root)

const version = process.env.GRIST_VERSION ?? pkg.version
const channel = process.env.GRIST_CHANNEL ?? "local"

type Target = { os: "linux" | "darwin" | "win32"; arch: "x64" | "arm64"; abi?: "musl" }

// Publish matrix: every platform bun can compile to. (v1 also shipped
// avx2-baseline variants; bun has no baseline compile target, and v1's were
// warn-and-continue anyway, so they are dropped here.)
const allTargets: Target[] = [
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "linux", arch: "arm64", abi: "musl" },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "win32", arch: "x64" },
  { os: "win32", arch: "arm64" },
]

function targetName(t: Target): string {
  return ["grist", t.os === "win32" ? "windows" : t.os, t.arch, t.abi].filter(Boolean).join("-")
}

function bunTarget(t: Target): Bun.Build.CompileTarget {
  const platform = t.os === "win32" ? "windows" : t.os
  const arch = t.arch === "arm64" ? "aarch64" : t.arch
  return `bun-${platform}-${arch}${t.abi === "musl" ? "-musl" : ""}` as Bun.Build.CompileTarget
}

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

async function buildOne(opts: {
  target: Bun.Build.CompileTarget
  outfile: string
  pty: { platform: string; arch: string; libc?: "glibc" | "musl" }
  libcDefine: string | undefined
}) {
  // Embed the platform pty binary the same way the main CLI build does, so
  // the compiled binary doesn't need @opencode-ai/pty-<platform> at runtime.
  const opencodePty = await resolveOpencodePty(opts.pty)
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
      target: opts.target,
      outfile: opts.outfile,
      execArgv: ["--smol", `--user-agent=grist/${channel}/${version}/cli`, "--use-system-ca", "--no-warnings", "--"],
      ...(opts.target.startsWith("bun-windows") ? { windows: {} } : {}),
    },
    define: {
      GRIST_BINARY: "true",
      OPENCODE_VERSION: JSON.stringify(version),
      OPENCODE_CLI_NAME: "'grist'",
      OPENCODE_CHANNEL: JSON.stringify(channel),
      OPENCODE_ARTIFACT: "'cli'",
      ...(opts.libcDefine !== undefined
        ? {
            OPENCODE_LIBC: JSON.stringify(opts.libcDefine),
            FFF_LIBC: JSON.stringify(opts.libcDefine === "musl" ? "musl" : "gnu"),
            "process.env.OPENTUI_LIBC": JSON.stringify(opts.libcDefine),
          }
        : {}),
    },
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
  console.log(`wrote ${opts.outfile}`)
}

if (allTargetsFlag) {
  await rm(outdir, { recursive: true, force: true })
  for (const t of allTargets) {
    const name = targetName(t)
    const dir = path.join(outdir, name, "bin")
    await mkdir(dir, { recursive: true })
    console.log(`building grist ${version} (${channel}) for ${bunTarget(t)}`)
    await buildOne({
      target: bunTarget(t),
      outfile: path.join(dir, "grist"),
      pty: {
        platform: t.os === "win32" ? "win32" : t.os,
        arch: t.arch,
        libc: t.abi ?? (t.os === "linux" ? "glibc" : undefined),
      },
      libcDefine: t.os === "linux" ? (t.abi ?? "glibc") : undefined,
    })
    await Bun.file(path.join(outdir, name, "package.json")).write(
      JSON.stringify(
        {
          name,
          version,
          preferUnplugged: true,
          os: [t.os],
          cpu: [t.arch],
          ...(t.abi ? { libc: [t.abi] } : {}),
        },
        null,
        2,
      ),
    )
  }
} else {
  const platform = process.platform === "win32" ? "windows" : process.platform
  const arch = process.arch === "arm64" ? "aarch64" : process.arch
  const target = (requestedTarget ?? `bun-${platform}-${arch}`) as Bun.Build.CompileTarget
  console.log(`building grist ${version} (${channel}) for ${target}`)
  await rm(outdir, { recursive: true, force: true })
  await mkdir(outdir, { recursive: true })
  await buildOne({
    target,
    outfile: path.join(outdir, "grist"),
    pty: {
      platform: process.platform,
      arch: process.arch as "x64" | "arm64",
      ...(process.platform === "linux" ? { libc: "glibc" as const } : {}),
    },
    libcDefine: process.platform === "linux" ? "glibc" : undefined,
  })
}
