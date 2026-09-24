import { describe, expect, test } from "bun:test"
import { SURGICAL_ENGINEER, identityDoctrine, sessionNudges, surgicalEngineer } from "./doctrine"
import { clearSessionMechanisms, composeMechanisms, rememberSessionMechanisms } from "./mechanisms"

describe("doctrine", () => {
  test("default includes edit_verify nudge", () => {
    expect(SURGICAL_ENGINEER).toContain("edit_verify")
  })

  test("default includes the context-economy nudge", () => {
    expect(SURGICAL_ENGINEER).toContain("Context economy")
  })

  test("fusion off drops edit_verify nudge", () => {
    const id = "sess-doctrine-off"
    rememberSessionMechanisms(id, composeMechanisms("anything", "off"))
    expect(surgicalEngineer(id)).not.toContain("edit_verify")
    expect(surgicalEngineer(id)).not.toContain("Context economy")
    clearSessionMechanisms(id)
  })

  test("compressor off drops the context-economy nudge", () => {
    const id = "sess-doctrine-perf"
    rememberSessionMechanisms(id, composeMechanisms("run the tests", "auto"))
    expect(surgicalEngineer(id)).toContain("edit_verify")
    expect(surgicalEngineer(id)).not.toContain("Context economy")
    clearSessionMechanisms(id)
  })

  test("identityDoctrine is stable and omits mechanism nudges", () => {
    expect(identityDoctrine()).not.toContain("edit_verify")
    expect(identityDoctrine()).not.toContain("Context economy")
    expect(identityDoctrine()).toBe(identityDoctrine())
  })

  test("sessionNudges sit after the cache boundary", () => {
    expect(sessionNudges()).toContain("edit_verify")
    const id = "sess-nudge-off"
    rememberSessionMechanisms(id, composeMechanisms("anything", "off"))
    expect(sessionNudges(id)).toBeUndefined()
    clearSessionMechanisms(id)
  })
})
