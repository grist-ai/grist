#!/usr/bin/env bun
/**
 * Publish Grist CLI to npm as `grist-ai` (+ platform packages `grist-<os>-<arch>[-musl]`).
 *
 * Prerequisites:
 *   bun run --cwd packages/grist script/build.ts --all-targets
 *   npm login locally, or GitHub Actions OIDC trusted publishing (no NODE_AUTH_TOKEN)
 *
 * Version/channel come from GRIST_VERSION / GRIST_CHANNEL (same as script/build.ts);
 * they must match the version the binaries were built with.
 */
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const PRODUCT_BIN = "grist"
const PRODUCT_NPM = "grist-ai"
const PRODUCT_PREFIX = "grist"
const PRODUCT_DESCRIPTION = "Grist — confidence-gated coding agent"
const PRODUCT_REPO = "grist-ai/grist"

const prepareOnly = Boolean(process.env.GRIST_PREPARE_ONLY)
// Provenance attestations need the GitHub OIDC identity; a local
// `npm login` publish has none, so only request them in CI.
const wantProvenance = Boolean(process.env.GITHUB_ACTIONS)
const channel = process.env.GRIST_CHANNEL ?? "latest"

import pkg from "../package.json"
const version = process.env.GRIST_VERSION ?? pkg.version

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

async function packageExists(name: string) {
  return (await $`npm view ${name} versions`.nothrow()).exitCode === 0
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
  const args = ["publish", "--access", "public", "--tag", channel]
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
  const name = String(pkg.name)
  // Platform packages only: skip the wrapper (dist/grist-ai) and the skills
  // package (dist/grist-skills) from earlier runs — dist/ is rebuilt by
  // build.ts --all-targets, but a stale wrapper must never become its own
  // optionalDependency.
  if (!name.startsWith(`${PRODUCT_PREFIX}-`)) continue
  if (name === PRODUCT_NPM || name.startsWith("@grist-ai/")) continue
  binaries[name] = pkg.version
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

const binariesVersion = Object.values(binaries)[0]
if (!binariesVersion) {
  console.error("No platform packages in dist/. Run: bun run --cwd packages/grist script/build.ts --all-targets")
  process.exit(1)
}
if (binariesVersion !== version) {
  throw new Error(`dist binaries are ${binariesVersion} but GRIST_VERSION is ${version}; rebuild first`)
}

const wrapperDir = `./dist/${PRODUCT_NPM}`
await $`mkdir -p ${wrapperDir}/bin`
await $`cp ../cli/script/postinstall.mjs ${wrapperDir}/postinstall.mjs`
await Bun.file(`${wrapperDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`${wrapperDir}/README.md`).write(`# ${PRODUCT_NPM}

${PRODUCT_DESCRIPTION}

\`\`\`bash
npm install -g ${PRODUCT_NPM}
${PRODUCT_BIN}
\`\`\`

BYOK: export \`GRIST_API_KEY\` (a \`grist_sk_…\` key from the Grist dashboard) —
inference bills to your own provider key. The Jev gate picks the cheapest
capable rung per run; never pin one with \`-m\`.

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
      scripts: { postinstall: "node ./postinstall.mjs" },
      version,
      license: "MIT",
      repository: { type: "git", url: `https://github.com/${PRODUCT_REPO}.git` },
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

for (const name of Object.keys(binaries)) {
  const pkgDir = name // platform package dir is dist/<name>
  try {
    await publish(`./dist/${pkgDir}`, name, version)
  } catch (err) {
    // A brand-new package name (e.g. grist-windows-*) can't be first-published
    // via OIDC trusted publishing — the trusted publisher is configured per
    // existing package on npmjs.com, so the first publish needs a classic
    // token. That must not block the rest of the release (darwin/linux and
    // the grist-ai wrapper). A name that already exists but failed to publish
    // is a real problem: fail loudly.
    if (!(await packageExists(name))) {
      console.warn(
        `warning: skipping ${name}@${version} — package does not exist on npm yet, ` +
          `publish it once with an npm login first (${(err as Error).message})`,
      )
      continue
    }
    throw err
  }
}
await publish(wrapperDir, PRODUCT_NPM, version)
await publish("./dist/grist-skills", skills.name, skills.version)
