#!/usr/bin/env bun
/**
 * Publish Grist CLI to npm as `grist-ai` (+ platform packages `grist-<os>-<arch>`).
 *
 * Prerequisites:
 *   bun run --cwd packages/opencode script/build.ts
 *   npm login locally, or GitHub Actions OIDC trusted publishing (no NODE_AUTH_TOKEN)
 *
 * Optional: OPENCODE_VERSION=0.1.0 OPENCODE_CHANNEL=latest
 */
import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"
import { PRODUCT_BIN, PRODUCT_DESCRIPTION, PRODUCT_NPM, PRODUCT_PREFIX, PRODUCT_REPO } from "./product"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(cwd: string, name: string, version: string) {
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(cwd)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  const pkgFile = Bun.file(`${cwd}/package.json`)
  const pkg = await pkgFile.json()
  pkg.repository = { type: "git", url: `https://github.com/${PRODUCT_REPO}.git` }
  await pkgFile.write(`${JSON.stringify(pkg, null, 2)}\n`)
  await $`bun pm pack`.cwd(cwd)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(cwd)
}

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  if (!String(pkg.name).startsWith(`${PRODUCT_PREFIX}-`)) continue
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)

const version = Object.values(binaries)[0]
if (!version) {
  console.error("No platform packages in dist/. Run: bun run --cwd packages/opencode script/build.ts")
  process.exit(1)
}

const wrapperDir = `./dist/${PRODUCT_NPM}`
await $`mkdir -p ${wrapperDir}/bin`
await $`cp ./script/postinstall.mjs ${wrapperDir}/postinstall.mjs`
await Bun.file(`${wrapperDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`${wrapperDir}/README.md`).write(`# ${PRODUCT_NPM}

${PRODUCT_DESCRIPTION}

\`\`\`bash
npm install -g ${PRODUCT_NPM}
${PRODUCT_BIN}
\`\`\`

Invite-gated. Sign in with \`${PRODUCT_BIN} auth login\` — testers do not need an API key.

Repo: https://github.com/${PRODUCT_REPO}
`)

await Bun.file(`${wrapperDir}/bin/${PRODUCT_BIN}.exe`).write(
  [
    `echo "Error: ${PRODUCT_NPM}'s postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when using --ignore-scripts during installation, or when using a" >&2',
    'echo "package manager like pnpm that does not run postinstall scripts by default." >&2',
    'echo "" >&2',
    'echo "To fix this, run the postinstall script manually:" >&2',
    `echo "  cd node_modules/${PRODUCT_NPM} && node postinstall.mjs" >&2`,
    'echo "" >&2',
    `echo "Or reinstall ${PRODUCT_NPM} without the --ignore-scripts flag." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)

await Bun.file(`${wrapperDir}/package.json`).write(
  JSON.stringify(
    {
      name: PRODUCT_NPM,
      description: PRODUCT_DESCRIPTION,
      bin: {
        [PRODUCT_BIN]: `./bin/${PRODUCT_BIN}.exe`,
      },
      scripts: {
        postinstall: "node ./postinstall.mjs",
      },
      version,
      license: "MIT",
      repository: {
        type: "git",
        url: `https://github.com/${PRODUCT_REPO}.git`,
      },
      homepage: `https://github.com/${PRODUCT_REPO}#readme`,
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

for (const name of Object.keys(binaries)) {
  await publish(`./dist/${name}`, name, binaries[name])
}
await publish(wrapperDir, PRODUCT_NPM, version)

console.log(`Published ${PRODUCT_NPM}@${version}`)
console.log(`Install: npm install -g ${PRODUCT_NPM}`)
