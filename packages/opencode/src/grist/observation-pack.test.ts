import { describe, expect, test } from "bun:test"
import {
  PACK_BYTES,
  consider,
  excerptEnds,
  excerptHead,
  identity,
  resetSession,
} from "./observation-pack"

describe("observation-pack", () => {
  test("identity is stable for same tool+text", () => {
    expect(identity("bash", "hello")).toBe(identity("bash", "hello"))
    expect(identity("bash", "hello")).not.toBe(identity("bash", "hello!"))
  })

  test("small outputs passthrough", () => {
    resetSession("s1")
    const d = consider({ sessionID: "s1", toolID: "bash", text: "tiny" })
    expect(d.action).toBe("passthrough")
  })

  test("large outputs full twice then pack", () => {
    resetSession("s2")
    const text = "x".repeat(PACK_BYTES + 100)
    const a = consider({ sessionID: "s2", toolID: "bash", text })
    const b = consider({ sessionID: "s2", toolID: "bash", text })
    const c = consider({ sessionID: "s2", toolID: "bash", text })
    expect(a.action).toBe("passthrough")
    expect(b.action).toBe("passthrough")
    expect(c.action).toBe("pack")
    if (c.action === "pack") {
      expect(c.count).toBe(3)
      expect(c.excerpt.length).toBeGreaterThan(0)
      expect(Buffer.byteLength(c.excerpt, "utf-8")).toBeLessThanOrEqual(1024)
    }
  })

  test("excerptHead respects byte budget", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line-${i}-${"y".repeat(40)}`).join("\n")
    const ex = excerptHead(text, 200)
    expect(Buffer.byteLength(ex, "utf-8")).toBeLessThanOrEqual(200)
  })

  test("excerptEnds keeps head and tail", () => {
    const text = ["HEAD-marker", "m".repeat(2000), "ERROR-at-the-end"].join("\n")
    const ex = excerptEnds(text, 1024)
    expect(ex).toContain("HEAD-marker")
    expect(ex).toContain("ERROR-at-the-end")
    expect(Buffer.byteLength(ex, "utf-8")).toBeLessThanOrEqual(1024)
  })

  test("packed excerpt keeps tail errors", () => {
    resetSession("s3")
    const text = ["START-compile", "x".repeat(PACK_BYTES), "error TS2322: Type 'string' is not assignable"].join("\n")
    consider({ sessionID: "s3", toolID: "bash", text })
    consider({ sessionID: "s3", toolID: "bash", text })
    const packed = consider({ sessionID: "s3", toolID: "bash", text })
    expect(packed.action).toBe("pack")
    if (packed.action === "pack") {
      expect(packed.excerpt).toContain("START-compile")
      expect(packed.excerpt).toContain("error TS2322")
      expect(Buffer.byteLength(packed.excerpt, "utf-8")).toBeLessThanOrEqual(1024)
    }
  })
})
