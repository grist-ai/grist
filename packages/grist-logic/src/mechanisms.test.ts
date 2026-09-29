import { describe, expect, test } from "bun:test"
import { loadEffort, shadowEffort, shadowMechanismChoice } from "./mechanisms.js"
import { exploratoryCapForEffort } from "./control-plane.js"

describe("loadEffort", () => {
  test("accepts low/standard/high case-insensitively with whitespace", () => {
    expect(loadEffort("low")).toBe("low")
    expect(loadEffort("HIGH")).toBe("high")
    expect(loadEffort(" Standard ")).toBe("standard")
  })

  test("returns undefined when unset or invalid so resolution can fall through", () => {
    expect(loadEffort("")).toBeUndefined()
    expect(loadEffort("max")).toBeUndefined()
  })
})

describe("shadowEffort", () => {
  test("exploration-heavy and multi-step tasks resolve high", () => {
    expect(shadowEffort("investigate why the build hangs")).toBe("high")
    expect(shadowEffort("refactor auth across the codebase")).toBe("high")
  })

  test("trivial single-file tasks resolve low", () => {
    expect(shadowEffort("fix the typo in the readme")).toBe("low")
    expect(shadowEffort("one-line docs tweak")).toBe("low")
  })

  test("defaults to standard", () => {
    expect(shadowEffort("update the parser")).toBe("standard")
  })

  test("shadowMechanismChoice carries effort through", () => {
    expect(shadowMechanismChoice("diagnose a flaky test").effort).toBe("high")
    expect(shadowMechanismChoice("one-line typo fix").effort).toBe("low")
  })
})

describe("exploratoryCapForEffort", () => {
  test("maps low/standard/high to 4/8/16", () => {
    expect(exploratoryCapForEffort("low", {})).toBe(4)
    expect(exploratoryCapForEffort("standard", {})).toBe(8)
    expect(exploratoryCapForEffort("high", {})).toBe(16)
  })

  test("GRIST_CTRL_EXPLORE_CAP overrides the mapping when set", () => {
    expect(exploratoryCapForEffort("low", { GRIST_CTRL_EXPLORE_CAP: "12" })).toBe(12)
  })
})
