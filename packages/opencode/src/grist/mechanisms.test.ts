import { describe, expect, test } from "bun:test"
import {
  clearSessionMechanisms,
  composeMechanisms,
  loadMechanismProfile,
  rememberSessionMechanisms,
  sessionAllowsActionFusion,
  sessionAllowsObservationPack,
  sessionAllowsObservationPackCompressor,
  shadowMechanismChoice,
} from "./mechanisms"

describe("mechanisms", () => {
  test("loadMechanismProfile aliases", () => {
    expect(loadMechanismProfile("efficiency")).toBe("efficiency")
    expect(loadMechanismProfile("perf")).toBe("performance")
    expect(loadMechanismProfile("off")).toBe("off")
    expect(loadMechanismProfile(undefined)).toBe("auto")
  })

  test("shadow routes exploration to efficiency with the compressor", () => {
    const c = shadowMechanismChoice("Explore why the worker hangs on reconnect")
    expect(c.resolved).toBe("efficiency")
    expect(c.exploration).toBe(true)
    expect(c.reasons).toContain("exploration_compressor")
  })

  test("shadow picks efficiency for build/test without the compressor", () => {
    const c = shadowMechanismChoice("Fix the failing lint and add a unit test")
    expect(c.resolved).toBe("efficiency")
    expect(c.exploration).toBe(false)
  })

  test("composeMechanisms off disables all", () => {
    const m = composeMechanisms("anything", "off")
    expect(m.observationPack).toBe(false)
    expect(m.observationPackCompressor).toBe(false)
    expect(m.actionFusion).toBe(false)
  })

  test("session store gates ObservationPack", () => {
    const id = "sess-mech-test"
    rememberSessionMechanisms(id, composeMechanisms("explore the bug", "auto"))
    expect(sessionAllowsObservationPack(id)).toBe(true)
    rememberSessionMechanisms(id, composeMechanisms("run the tests", "performance"))
    expect(sessionAllowsObservationPack(id)).toBe(false)
    clearSessionMechanisms(id)
    expect(sessionAllowsObservationPack(id)).toBe(true)
  })

  test("session store gates the ObservationPack compressor", () => {
    const id = "sess-compress-test"
    rememberSessionMechanisms(id, composeMechanisms("explore the bug", "auto"))
    expect(sessionAllowsObservationPackCompressor(id)).toBe(true)
    rememberSessionMechanisms(id, composeMechanisms("run the tests", "auto"))
    expect(sessionAllowsObservationPackCompressor(id)).toBe(false)
    rememberSessionMechanisms(id, composeMechanisms("anything", "performance"))
    expect(sessionAllowsObservationPackCompressor(id)).toBe(false)
    clearSessionMechanisms(id)
    expect(sessionAllowsObservationPackCompressor(id)).toBe(true)
  })

  test("session store gates Action Fusion", () => {
    const id = "sess-fusion-test"
    rememberSessionMechanisms(id, composeMechanisms("anything", "off"))
    expect(sessionAllowsActionFusion(id)).toBe(false)
    rememberSessionMechanisms(id, composeMechanisms("run the tests", "efficiency"))
    expect(sessionAllowsActionFusion(id)).toBe(true)
    clearSessionMechanisms(id)
    expect(sessionAllowsActionFusion(id)).toBe(true)
  })
})
