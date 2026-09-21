import { describe, expect, test } from "bun:test"
import { SURGICAL_ENGINEER, surgicalEngineer } from "./doctrine"
import { clearSessionMechanisms, composeMechanisms, rememberSessionMechanisms } from "./mechanisms"

describe("doctrine", () => {
  test("default includes edit_verify nudge", () => {
    expect(SURGICAL_ENGINEER).toContain("edit_verify")
  })

  test("fusion off drops edit_verify nudge", () => {
    const id = "sess-doctrine-off"
    rememberSessionMechanisms(id, composeMechanisms("anything", "off"))
    expect(surgicalEngineer(id)).not.toContain("edit_verify")
    clearSessionMechanisms(id)
  })
})
