#!/usr/bin/env bun
import { $ } from "bun"
import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PRODUCT_VERSION, UPDATES } from "../brand"

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const dist = process.env.GRIST_DESKTOP_DIST?.trim() || path.join(packageDir, "..", "dist")
const repo = `${UPDATES.owner}/${UPDATES.repo}`
const tag = PRODUCT_VERSION
const names = [
  "grist-desktop-mac-arm64.dmg",
  "grist-desktop-mac-arm64.zip",
  "latest-mac.yml",
  "grist-desktop-mac-arm64.zip.blockmap",
  "grist-desktop-mac-arm64.dmg.blockmap",
]

if (!existsSync(dist)) throw new Error(`Desktop dist not found: ${dist}`)

async function findAsset(name: string) {
  const direct = path.join(dist, name)
  if (await Bun.file(direct).exists()) return direct
  const entries = await readdir(dist, { withFileTypes: true })
  const nested = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dist, entry.name, name))
  const match = nested.find((file) => existsSync(file))
  return match
}

const yml = await findAsset("latest-mac.yml")
if (!yml) throw new Error(`latest-mac.yml not found in ${dist}. Package the Mac app before publishing.`)

const versionLine = (await Bun.file(yml).text()).split("\n").find((line) => line.startsWith("version:"))
const ymlVersion = versionLine?.slice("version:".length).trim()
if (ymlVersion !== PRODUCT_VERSION) {
  throw new Error(`latest-mac.yml version ${ymlVersion} does not match PRODUCT_VERSION ${PRODUCT_VERSION}`)
}

const files = (await Promise.all(names.map(findAsset))).filter((file): file is string => !!file)
if (!files.some((file) => file.endsWith(".zip"))) {
  throw new Error("Mac zip is required for auto-update.")
}
if (!files.some((file) => file.endsWith(".dmg"))) {
  throw new Error("Mac DMG is required for the website download.")
}

const existing = await $`gh release view ${tag} --repo ${repo}`.nothrow()
if (existing.exitCode !== 0) {
  await $`gh release create ${tag} --repo ${repo} --title ${"Grist " + tag} --notes ${"Grist desktop " + tag}`
}

await $`gh release upload ${tag} ${files} --repo ${repo} --clobber`
console.log(`Published ${files.length} assets to ${repo}@${tag}`)
