import { join } from "node:path"

export const SPEECH_PROTOCOL = "grist-speech"
export const SPEECH_MODEL_HOST = "models"

export function speechResourceRoot(input: { packaged: boolean; resourcesPath: string; packageRoot: string }) {
  if (input.packaged) return join(input.resourcesPath, "moonshine")
  return join(input.packageRoot, "resources/moonshine")
}

export function resolveSpeechAsset(requestUrl: string, root: string) {
  const url = new URL(requestUrl)
  if (url.protocol !== `${SPEECH_PROTOCOL}:`) return
  if (url.hostname !== SPEECH_MODEL_HOST) return
  const name = decodeURIComponent(url.pathname).replace(/^\/+/, "")
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return
  return join(root, name)
}
