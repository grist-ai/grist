import { Option, Schema } from "effect"

// GitHub's latest-release payload for grist-ai/grist-downloads. The beta
// channel's external Mac install downloads the DMG straight from the release
// assets instead of going through an update API.
const Asset = Schema.Struct({
  name: Schema.String,
  browser_download_url: Schema.String,
})
const Release = Schema.Struct({
  tag_name: Schema.String,
  assets: Schema.Array(Asset),
})
const decode = Schema.decodeUnknownOption(Release)

export function requiresStableMacInstaller(platform: string, channel: string) {
  return platform === "darwin" && channel === "beta"
}

export function stableMacDownload(input: unknown, arch: string) {
  if (arch !== "arm64" && arch !== "x64") return undefined
  const release = Option.getOrUndefined(decode(input))
  if (!release) return undefined
  const asset = release.assets.find((entry) => entry.name === `grist-desktop-mac-${arch}.dmg`)
  return asset && { version: release.tag_name, url: asset.browser_download_url }
}
