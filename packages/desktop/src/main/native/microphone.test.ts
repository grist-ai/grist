import { describe, expect, test } from "bun:test"
import { ensureMicrophoneAccess } from "./microphone"

describe("ensureMicrophoneAccess", () => {
  test("skips the prompt when access is already granted", async () => {
    const flags = { asked: false, opened: false }
    const allowed = await ensureMicrophoneAccess({
      status: "granted",
      ask: async () => {
        flags.asked = true
        return false
      },
      openSettings: () => {
        flags.opened = true
      },
    })
    expect(allowed).toBe(true)
    expect(flags.asked).toBe(false)
    expect(flags.opened).toBe(false)
  })

  test("asks macOS when the status is not determined", async () => {
    const allowed = await ensureMicrophoneAccess({
      status: "not-determined",
      ask: async () => true,
      openSettings: () => {
        throw new Error("should not open settings")
      },
    })
    expect(allowed).toBe(true)
  })

  test("opens System Settings when macOS already denied the app", async () => {
    const flags = { asked: false, opened: false }
    const allowed = await ensureMicrophoneAccess({
      status: "denied",
      ask: async () => {
        flags.asked = true
        return true
      },
      openSettings: () => {
        flags.opened = true
      },
    })
    expect(allowed).toBe(false)
    expect(flags.asked).toBe(false)
    expect(flags.opened).toBe(true)
  })
})
