import { describe, expect, test } from "bun:test"
import { flattenPcm, joinPromptText, resamplePcm } from "./voice-input"
import { isWhisperDownloadProgress, textFromAsr } from "./whisper-local"

describe("voice input text", () => {
  test("inserts a space between existing prompt text and speech", () => {
    expect(joinPromptText("Fix the", "scroll bug")).toBe("Fix the scroll bug")
    expect(joinPromptText("Fix the ", "scroll bug")).toBe("Fix the scroll bug")
    expect(joinPromptText("", "hello")).toBe("hello")
    expect(joinPromptText("hello", "   ")).toBe("hello")
  })
})

describe("pcm helpers", () => {
  test("resamples a ramp down to 16 kHz", () => {
    const input = Float32Array.from({ length: 4 }, (_, i) => i)
    const output = resamplePcm(input, 32_000, 16_000)
    expect(output.length).toBe(2)
    expect(output[0]).toBe(0)
    expect(output[1]).toBeCloseTo(2)
  })

  test("averages stereo channels into mono", () => {
    const mixed = flattenPcm([new Float32Array([1, 3]), new Float32Array([3, 1])])
    expect(Array.from(mixed)).toEqual([2, 2])
  })
})

describe("whisper progress", () => {
  test("treats incomplete file fetches as downloads", () => {
    expect(isWhisperDownloadProgress({ status: "progress", progress: 0.4 })).toBe(true)
    expect(isWhisperDownloadProgress({ status: "ready" })).toBe(false)
    expect(textFromAsr({ text: "  hello " })).toBe("hello")
    expect(textFromAsr([{ text: "one" }, { text: "two" }])).toBe("one two")
  })
})
