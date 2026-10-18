import { defineConfig } from "electron-vite"
import type { Plugin } from "vite"
import { pickerPlugin } from "./scripts/picker"
import * as fs from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { moonshinePthreadCopy } from "./src/main/windows/pthread-assets"
import { nodePtyPackage } from "./scripts/utils"

function resolveChannel() {
  const raw = process.env.OPENCODE_CHANNEL

  if (raw === "local" || raw === "dev" || raw === "beta" || raw === "prod") return raw

  if (raw === "latest") return "prod"

  return "dev"
}

const appPlugin = (await import("@opencode/app/vite")).default

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? (await import("@sentry/vite-plugin")).sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

// Every module the entry reaches through static imports lands in one chunk. Automatic splitting
// otherwise fragments the initial graph into ~50 files shared with lazy routes, and each file costs
// the renderer a main-thread request round trip through the main process before first paint.
// Rolldown hands every chunk-name call a fresh context, so the graph is walked once per output.
const initialGraph = new Set<string>()

const initialChunk: Plugin = {
  name: "opencode-desktop:initial-chunk",
  renderStart() {
    const entries = [...this.getModuleIds()].filter((id) => this.getModuleInfo(id)?.isEntry)
    initialGraph.clear()
    entries.forEach((id) => initialGraph.add(id))

    // A Set's iterator also visits members added while iterating, so this reaches every static import.
    for (const id of initialGraph) this.getModuleInfo(id)?.importedIds.forEach((imported) => initialGraph.add(imported))
  },
}

export default defineConfig(({ command }) => {
  const channel = resolveChannel()
  const nodePtyPkg = nodePtyPackage()

  return {
    main: {
      resolve: {
        dedupe: ["effect"],
      },
      define: {
        // Local renderer/server mode still uses the dev application identity and updater policy.
        "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel === "local" ? "dev" : channel),
      },
      build: {
        minify: command === "build",
        rolldownOptions: {
          input: { index: "src/main/index.ts" },
          // Keep this identical to electron-vite's Node 20.11+ shim. Its regex insertion can
          // corrupt bundled TypeScript, while an output banner places the shim safely.
          output: {
            format: "es",
            // DesktopPaths resolves resources from the main output directory,
            // including when the lazy desktop entry shares it with other chunks.
            chunkFileNames: "[name]-[hash].js",
            banner: `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`,
          },
        },
        externalizeDeps: {
          // Bundle the Effect family together.
          exclude: ["effect", "@effect/platform-node", "@effect/platform-node-shared", "drizzle-orm", "@grist-ai/logic"],
          include: [nodePtyPkg],
        },
      },
      plugins: [
        {
          name: "opencode:node-pty-narrower",
          enforce: "pre",
          resolveId(s) {
            if (s === "@lydell/node-pty") return nodePtyPkg

            return undefined
          },
        },
      ],
    },
    preload: {
      build: {
        minify: command === "build",
        rolldownOptions: {
          input: { index: "src/preload/index.ts" },
          output: {
            format: "cjs",
            // The package is "type": "module". Under --no-sandbox Electron loads the preload
            // through Node's module loader, which treats a .js file as ESM and fails on
            // require("electron"). The sandboxed path ignores the extension.
            entryFileNames: "[name].cjs",
          },
        },
      },
    },
    renderer: {
      experimental: {
        bundledDev: true,
      },
      define: {
        "import.meta.env.OPENCODE_VERSION": JSON.stringify(process.env.OPENCODE_VERSION),
        "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
        "import.meta.env.OPENCODE_TEST_ONBOARDING": JSON.stringify(
          command === "serve" && process.env.OPENCODE_TEST_ONBOARDING === "1",
        ),
      },
      plugins: [
        pickerPlugin(),
        appPlugin,
        initialChunk,
        sentry,
        // Emscripten pthread workers request the Moonshine glue by its unhashed name, so copy the
        // hashed build output next to it. The main-process protocol also falls back to the hashed
        // file when only it is on disk.
        {
          name: "grist:moonshine-pthread-assets",
          async writeBundle(output: { dir?: string }) {
            const dir = join(output.dir ?? "out/renderer", "assets")
            if (!existsSync(dir)) return
            const copies = moonshinePthreadCopy(await fs.readdir(dir))
            for (const copy of copies) {
              await fs.copyFile(join(dir, copy.from), join(dir, copy.to))
            }
          },
        },
      ],
      publicDir: "../../../app/public",
      root: "src/renderer",
      build: {
        minify: command === "build",
        sourcemap: true,
        rolldownOptions: {
          input: {
            main: "src/renderer/index.html",
          },
          output: {
            codeSplitting: {
              groups: [{ name: (id) => (initialGraph.has(id) ? "app" : null), priority: 10 }],
            },
          },
        },
      },
    },
  }
})
