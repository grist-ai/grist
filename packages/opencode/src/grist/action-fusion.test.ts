import { describe, expect, test } from "bun:test"
import { formatFusion } from "./action-fusion"

describe("action-fusion", () => {
  test("formatFusion includes edit and verify sections", () => {
    const out = formatFusion({
      filePath: "/tmp/a.ts",
      editOutput: "patched a.ts",
      verifyCommand: "bun test",
      verifyOutput: "ok",
      exit: 0,
    })
    expect(out).toContain("[grist:action-fusion]")
    expect(out).toContain("## Edit")
    expect(out).toContain("## Verify")
    expect(out).toContain("$ bun test")
    expect(out).toContain("verify_status=ok")
  })

  test("formatFusion marks failed verify", () => {
    const out = formatFusion({
      filePath: "x.ts",
      editOutput: "done",
      verifyCommand: "false",
      verifyOutput: "boom",
      exit: 1,
    })
    expect(out).toContain("verify_status=failed (exit 1)")
  })
})
