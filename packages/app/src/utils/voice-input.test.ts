import { describe, expect, test } from "bun:test"
import {
  flattenPcm,
  isSpeechModelDownload,
  joinPromptText,
  resamplePcm,
  mixVoiceActivity,
  sameActivity,
  textFromLines,
  voiceActivityLevels,
  voiceActivityRms,
} from "./voice-input"

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

describe("voice activity", () => {
  test("maps frequency bins onto bar levels", () => {
    expect(voiceActivityLevels(new Uint8Array([0, 0, 255, 255]), 2)).toEqual([0, 1])
    expect(voiceActivityLevels(new Uint8Array([64]), 1)[0]).toBeCloseTo(Math.sqrt(64 / 255))
    expect(voiceActivityLevels(new Uint8Array(), 3)).toEqual([0, 0, 0])
  })

  test("lifts every bar with the microphone level", () => {
    expect(mixVoiceActivity([0, 1], 0)).toEqual([0, 0.55])
    expect(mixVoiceActivity([0, 0], 1)).toEqual([0.9, 0.9])
    const silent = new Uint8Array(4).fill(128)
    expect(voiceActivityRms(silent)).toBe(0)
    expect(voiceActivityRms(new Uint8Array())).toBe(0)
  })

  test("treats tiny level changes as the same frame", () => {
    expect(sameActivity([0.2, 0.4], [0.22, 0.41])).toBe(true)
    expect(sameActivity([0.2], [0.4])).toBe(false)
  })
})

describe("moonshine transcript", () => {
  test("joins finished lines and ignores blanks", () => {
    expect(textFromLines(["  fix the scroll ", "", "bug"])).toBe("fix the scroll bug")
    expect(textFromLines([])).toBe("")
  })

  test("treats an unfinished model fetch as a download", () => {
    expect(isSpeechModelDownload(40, 100)).toBe(true)
    expect(isSpeechModelDownload(100, 100)).toBe(false)
    expect(isSpeechModelDownload(0, undefined)).toBe(true)
  })
})
