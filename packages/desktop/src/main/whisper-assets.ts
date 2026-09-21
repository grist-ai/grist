import { isAbsolute, join, relative, resolve } from "node:path"

export const WHISPER_PROTOCOL = "grist-model"
export const WHISPER_MODEL_ID = "onnx-community/whisper-large-v3-turbo"
export const BUNDLED_WHISPER_MODEL_BASE = `${WHISPER_PROTOCOL}://models/`
export const BUNDLED_WHISPER_WASM_BASE = `${WHISPER_PROTOCOL}://wasm/`

const whisperHosts = new Set(["models", "wasm"])

export function whisperResourceRoot(input: { packaged: boolean; resourcesPath: string; packageRoot: string }) {
  if (input.packaged) return join(input.resourcesPath, "whisper")
  return join(input.packageRoot, "resources/whisper")
}

export function resolveWhisperAsset(requestUrl: string, root: string) {
  if (!URL.canParse(requestUrl)) return
  const url = new URL(requestUrl)
  if (url.protocol !== `${WHISPER_PROTOCOL}:`) return
  if (!whisperHosts.has(url.hostname)) return
  const file = resolve(root, url.hostname, `.${decodeURIComponent(url.pathname)}`)
  const rel = relative(root, file)
  if (rel.startsWith("..") || isAbsolute(rel)) return
  return file
}
