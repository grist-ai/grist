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

const prepareOnly = Boolean(process.env.GRIST_PREPARE_ONLY)
// Provenance attestations need the GitHub OIDC identity; a local
// `npm login` publish has none, so only request them in CI.
const wantProvenance = Boolean(process.env.GITHUB_ACTIONS)

// Files that must never ship inside a published tarball. Checked per package
// dir before `npm publish`; fail closed so a stray secret or test fixture
// blocks the release instead of leaking onto the registry.
const FORBIDDEN_TARBALL_PATTERNS = [
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/test/**",
  "**/tests/**",
  "**/fixtures/**",
]

function assertNoForbiddenFiles(cwd: string, name: string) {
  const hits: string[] = []
  for (const pattern of FORBIDDEN_TARBALL_PATTERNS) {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd, dot: true })) hits.push(file)
  }
  if (hits.length === 0) return
  throw new Error(
    `refusing to publish ${name}: forbidden files in ${cwd}:\n${hits.map((h) => `  - ${h}`).join("\n")}`,
  )
}

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(cwd: string, name: string, version: string) {
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(cwd)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  assertNoForbiddenFiles(cwd, name)
  const pkgFile = Bun.file(`${cwd}/package.json`)
  const pkg = await pkgFile.json()
  pkg.repository = { type: "git", url: `https://github.com/${PRODUCT_REPO}.git` }
  await pkgFile.write(`${JSON.stringify(pkg, null, 2)}\n`)
  if (prepareOnly) {
    console.log(`prepared ${name}@${version}`)
    return
  }
  const args = ["publish", "--access", "public", "--tag", Script.channel]
  if (wantProvenance) args.push("--provenance")
  const result = Bun.spawnSync(["npm", ...args], {
    cwd,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) throw new Error(`npm publish failed for ${name}@${version}`)
}

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  if (!String(pkg.name).startsWith(`${PRODUCT_PREFIX}-`)) continue
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)

/**
 * Stage the @grist-ai/grist-skills npm package from skills/grist/ into
 * dist/grist-skills/. The publish-grist workflow's dist/grist-* loop picks it
 * up automatically (skip-if-published guard makes it a no-op on CLI-only
 * releases); bump skills/grist/package.json's version to cut a skill release.
 */
async function prepareSkills() {
  const src = fileURLToPath(new URL("../../../skills/grist", import.meta.url))
  const license = fileURLToPath(new URL("../../../LICENSE", import.meta.url))
  const dist = "./dist/grist-skills"
  const pkg = await Bun.file(`${src}/package.json`).json()
  const name = String(pkg.name)
  if (!name.startsWith("@grist-ai/")) throw new Error(`skills package must be @grist-ai/*, got ${name}`)
  await $`mkdir -p ${dist}`
  for (const file of ["SKILL.md", "README.md", "package.json"]) {
    const source = Bun.file(`${src}/${file}`)
    if (!(await source.exists())) throw new Error(`skills source missing: ${file}`)
    await Bun.write(`${dist}/${file}`, await source.text())
  }
  await Bun.write(`${dist}/LICENSE`, await Bun.file(license).text())
  const staged = await Bun.file(`${dist}/package.json`).json()
  staged.repository = {
    type: "git",
    url: `https://github.com/${PRODUCT_REPO}.git`,
    directory: "skills/grist",
  }
  await Bun.file(`${dist}/package.json`).write(`${JSON.stringify(staged, null, 2)}\n`)
  const version = String(staged.version)
  console.log(`prepared ${name}@${version}`)
  return { name, version }
}

const skills = await prepareSkills()

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

Invite-gated. Sign in with \`${PRODUCT_BIN} auth login --provider grist\` (invite or a dashboard \`grist_sk_\` key). Testers do not need an OpenAI or Anthropic key.

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
await publish("./dist/grist-skills", skills.name, skills.version)

console.log(`Published ${PRODUCT_NPM}@${version}`)
console.log(`Install: npm install -g ${PRODUCT_NPM}`)
