import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { resolveWhisperAsset, whisperResourceRoot, WHISPER_MODEL_ID, WHISPER_PROTOCOL } from "./whisper-assets"

describe("whisper assets", () => {
  test("serves packaged models from extraResources", () => {
    expect(
      whisperResourceRoot({
        packaged: true,
        resourcesPath: "/App/Resources",
        packageRoot: "/repo/packages/desktop",
      }),
    ).toBe(join("/App/Resources", "whisper"))
  })

  test("serves unpackaged models from the desktop package", () => {
    expect(
      whisperResourceRoot({
        packaged: false,
        resourcesPath: "/App/Resources",
        packageRoot: "/repo/packages/desktop",
      }),
    ).toBe(join("/repo/packages/desktop", "resources/whisper"))
  })

  test("resolves model and wasm paths under the whisper root", () => {
    const root = "/whisper"
    expect(resolveWhisperAsset(`${WHISPER_PROTOCOL}://models/${WHISPER_MODEL_ID}/config.json`, root)).toBe(
      join(root, "models", WHISPER_MODEL_ID, "config.json"),
    )
    expect(resolveWhisperAsset(`${WHISPER_PROTOCOL}://wasm/ort-wasm-simd-threaded.jsep.wasm`, root)).toBe(
      join(root, "wasm", "ort-wasm-simd-threaded.jsep.wasm"),
    )
  })

  test("rejects hosts and path traversal", () => {
    const root = "/whisper"
    expect(resolveWhisperAsset(`${WHISPER_PROTOCOL}://other/config.json`, root)).toBeUndefined()
    expect(resolveWhisperAsset(`${WHISPER_PROTOCOL}://models/..%2F..%2F..%2Fsecret.bin`, root)).toBeUndefined()
  })
})
