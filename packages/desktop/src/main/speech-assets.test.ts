import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { resolveSpeechAsset, speechResourceRoot, SPEECH_PROTOCOL } from "./speech-assets"

describe("speech assets", () => {
  test("uses the packaged resource directory", () => {
    expect(
      speechResourceRoot({
        packaged: true,
        resourcesPath: "/App/Resources",
        packageRoot: "/repo/packages/desktop",
      }),
    ).toBe(join("/App/Resources", "moonshine"))
  })

  test("uses the repo resource directory when unpackaged", () => {
    expect(
      speechResourceRoot({
        packaged: false,
        resourcesPath: "/App/Resources",
        packageRoot: "/repo/packages/desktop",
      }),
    ).toBe(join("/repo/packages/desktop", "resources/moonshine"))
  })

  test("resolves a model file under the speech root", () => {
    expect(resolveSpeechAsset(`${SPEECH_PROTOCOL}://models/encoder.ort`, "/moonshine")).toBe(
      join("/moonshine", "encoder.ort"),
    )
    expect(resolveSpeechAsset(`${SPEECH_PROTOCOL}://models/manifest.json`, "/moonshine")).toBe(
      join("/moonshine", "manifest.json"),
    )
  })

  test("rejects paths that leave the speech root", () => {
    expect(resolveSpeechAsset(`${SPEECH_PROTOCOL}://other/encoder.ort`, "/moonshine")).toBeUndefined()
    expect(resolveSpeechAsset(`${SPEECH_PROTOCOL}://models/..%2Fsecret.bin`, "/moonshine")).toBeUndefined()
    expect(resolveSpeechAsset(`${SPEECH_PROTOCOL}://models/nested/encoder.ort`, "/moonshine")).toBeUndefined()
  })
})
