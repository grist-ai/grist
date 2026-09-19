import { describe, expect, test } from "bun:test"
import {
  clearSessionMechanisms,
  composeMechanisms,
  loadMechanismProfile,
  rememberSessionMechanisms,
  sessionAllowsObservationPack,
  shadowMechanismChoice,
} from "./mechanisms"

describe("mechanisms", () => {
  test("loadMechanismProfile aliases", () => {
    expect(loadMechanismProfile("efficiency")).toBe("efficiency")
    expect(loadMechanismProfile("perf")).toBe("performance")
    expect(loadMechanismProfile("off")).toBe("off")
    expect(loadMechanismProfile(undefined)).toBe("auto")
  })

  test("shadow picks performance for exploration", () => {
    const c = shadowMechanismChoice("Explore why the worker hangs on reconnect")
    expect(c.resolved).toBe("performance")
  })

  test("shadow picks efficiency for build/test", () => {
    const c = shadowMechanismChoice("Fix the failing lint and add a unit test")
    expect(c.resolved).toBe("efficiency")
  })

  test("composeMechanisms off disables both", () => {
    const m = composeMechanisms("anything", "off")
    expect(m.observationPack).toBe(false)
    expect(m.actionFusion).toBe(false)
  })

  test("session store gates ObservationPack", () => {
    const id = "sess-mech-test"
    rememberSessionMechanisms(id, composeMechanisms("explore the bug", "auto"))
    expect(sessionAllowsObservationPack(id)).toBe(false)
    rememberSessionMechanisms(id, composeMechanisms("run the tests", "auto"))
    expect(sessionAllowsObservationPack(id)).toBe(true)
    clearSessionMechanisms(id)
    expect(sessionAllowsObservationPack(id)).toBe(true)
  })
})
