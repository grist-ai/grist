import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearWarmSession,
  noteResume,
  recordWarmChild,
  shouldNudge,
  warmSubagentsEnabled,
} from "./warm-subagents.js"

beforeEach(() => {
  clearWarmSession("parent-a")
  clearWarmSession("parent-b")
})

describe("recordWarmChild", () => {
  test("a recorded child nudges until its resume cap", () => {
    recordWarmChild("parent-a", "explore", "child-1")
    expect(shouldNudge("parent-a", "explore")).toBe(true)
  })

  test("sessions are isolated for the same agent", () => {
    recordWarmChild("parent-a", "explore", "child-1")
    noteResume("parent-a", "explore", "child-1")
    expect(shouldNudge("parent-b", "explore")).toBe(true)
    expect(shouldNudge("parent-a", "general")).toBe(true)
  })

  test("recording a different child resets the resume count", () => {
    recordWarmChild("parent-a", "explore", "child-1")
    noteResume("parent-a", "explore", "child-1")
    noteResume("parent-a", "explore", "child-1")
    noteResume("parent-a", "explore", "child-1")
    expect(shouldNudge("parent-a", "explore")).toBe(false)
    recordWarmChild("parent-a", "explore", "child-2")
    expect(shouldNudge("parent-a", "explore")).toBe(true)
  })
})

describe("noteResume", () => {
  test("stops nudging once resumes hit the default cap of 3", () => {
    recordWarmChild("parent-a", "explore", "child-1")
    noteResume("parent-a", "explore", "child-1")
    noteResume("parent-a", "explore", "child-1")
    expect(shouldNudge("parent-a", "explore")).toBe(true)
    noteResume("parent-a", "explore", "child-1")
    expect(shouldNudge("parent-a", "explore")).toBe(false)
  })

  test("honours GRIST_WARM_SUBAGENT_MAX_RESUMES", () => {
    recordWarmChild("parent-a", "explore", "child-1")
    noteResume("parent-a", "explore", "child-1")
    expect(shouldNudge("parent-a", "explore", { GRIST_WARM_SUBAGENT_MAX_RESUMES: "1" })).toBe(false)
    expect(shouldNudge("parent-a", "explore", { GRIST_WARM_SUBAGENT_MAX_RESUMES: "5" })).toBe(true)
    expect(shouldNudge("parent-a", "explore", { GRIST_WARM_SUBAGENT_MAX_RESUMES: "bogus" })).toBe(true)
  })

  test("resuming an unrecorded child starts tracking it at one resume", () => {
    noteResume("parent-a", "explore", "child-9")
    expect(shouldNudge("parent-a", "explore", { GRIST_WARM_SUBAGENT_MAX_RESUMES: "1" })).toBe(false)
    expect(shouldNudge("parent-a", "explore")).toBe(true)
  })
})

describe("clearWarmSession", () => {
  test("drops the parent's warm children without touching other sessions", () => {
    recordWarmChild("parent-a", "explore", "child-1")
    recordWarmChild("parent-b", "explore", "child-2")
    noteResume("parent-b", "explore", "child-2")
    noteResume("parent-b", "explore", "child-2")
    noteResume("parent-b", "explore", "child-2")
    clearWarmSession("parent-a")
    expect(shouldNudge("parent-a", "explore")).toBe(true)
    expect(shouldNudge("parent-b", "explore")).toBe(false)
  })
})

describe("warmSubagentsEnabled", () => {
  test("defaults on with the control plane", () => {
    expect(warmSubagentsEnabled({})).toBe(true)
  })

  test('"0" / "false" disable', () => {
    expect(warmSubagentsEnabled({ GRIST_WARM_SUBAGENTS: "0" })).toBe(false)
    expect(warmSubagentsEnabled({ GRIST_WARM_SUBAGENTS: "false" })).toBe(false)
  })

  test("off when the control plane is off, with no force-enable", () => {
    expect(warmSubagentsEnabled({ GRIST_CTRL: "off" })).toBe(false)
    expect(warmSubagentsEnabled({ GRIST_CTRL: "off", GRIST_WARM_SUBAGENTS: "1" })).toBe(false)
  })
})
