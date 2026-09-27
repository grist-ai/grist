import { describe, expect, test } from "bun:test"
import { rendererPermissions } from "./renderer-permissions"

describe("rendererPermissions", () => {
  test("allows microphone capture for voice input", () => {
    // Regression: the v2 port dropped these two, so getUserMedia({ audio: true })
    // was denied with NotAllowedError on every mic click (2026-09-27).
    expect(rendererPermissions.has("media")).toBe(true)
    expect(rendererPermissions.has("microphone")).toBe(true)
  })

  test("keeps the pre-existing grants", () => {
    expect(rendererPermissions.has("clipboard-sanitized-write")).toBe(true)
    expect(rendererPermissions.has("notifications")).toBe(true)
  })
})
