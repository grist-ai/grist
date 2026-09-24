import { describe, expect, test } from "bun:test"
import { SURGICAL_ENGINEER, surgicalEngineer } from "./doctrine"
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
})
