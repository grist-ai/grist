#!/usr/bin/env bun
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadMoonshineModule, ModelArch } from "@moonshine-ai/moonshine-wasm"

const moonshineRoot = join(dirname(fileURLToPath(import.meta.url)), "../resources/moonshine")

type ManifestFile = { name: string; url?: string; size?: number }
type ManifestGroup = { base_url?: string; files?: ManifestFile[] }

export async function fetchMoonshine() {
  const module = await loadMoonshineModule()
  const manifest = JSON.parse(module.sttDependencies("en", String(ModelArch.MediumStreaming), false)) as {
    groups?: ManifestGroup[]
  }
  const files = (manifest.groups ?? []).flatMap((group) =>
    (group.files ?? []).map((file) => ({
      name: file.name,
      size: file.size,
      url: file.url ?? (group.base_url ? `${group.base_url.replace(/\/+$/, "")}/${file.name}` : undefined),
    })),
  )
  await mkdir(moonshineRoot, { recursive: true })
  for (const file of files) {
    if (!file.url) throw new Error(`Moonshine manifest has no URL for ${file.name}`)
    await download(file.url, join(moonshineRoot, file.name), file.size)
  }
  await Bun.write(
    join(moonshineRoot, "manifest.json"),
    JSON.stringify({ arch: "medium_streaming", files: files.map((file) => file.name) }),
  )
}

async function download(url: string, dest: string, size?: number) {
  if (await complete(dest, size)) {
    console.log(`skip ${dest}`)
    return
  }
  await mkdir(dirname(dest), { recursive: true })
  console.log(`fetch ${url}`)
  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  await Bun.write(dest, response)
  if (!(await complete(dest, size))) throw new Error(`incomplete download ${dest}`)
}

async function complete(dest: string, size?: number) {
  const file = Bun.file(dest)
  if (!(await file.exists())) return false
  if (size === undefined) return file.size > 0
  return file.size === size
}

if (import.meta.main) await fetchMoonshine()
