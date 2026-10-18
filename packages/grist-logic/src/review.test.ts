import { describe, expect, test } from "bun:test"
import { commentSteerText, hunkPatch, parseFilePatch } from "./review"

const PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,3 @@",
  " const a = 1",
  "-const b = 2",
  "+const b = 20",
  " const c = 3",
  "@@ -10,3 +10,4 @@ export function run()",
  " const x = 1",
  " const y = 2",
  "+const z = 3",
  " const w = 4",
  "",
].join("\n")

describe("parseFilePatch", () => {
  const parsed = parseFilePatch("src/app.ts", PATCH)

  test("splits the preamble and hunks", () => {
    expect(parsed.preamble).toEqual([
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
    ])
    expect(parsed.hunks).toHaveLength(2)
  })

  test("hunk identities are line-anchored and counts are computed", () => {
    expect(parsed.hunks[0].id).toBe("src/app.ts#1")
    expect(parsed.hunks[0].additions).toBe(1)
    expect(parsed.hunks[0].deletions).toBe(1)
    expect(parsed.hunks[1].id).toBe("src/app.ts#10")
    expect(parsed.hunks[1].newLines).toBe(4)
  })
})

describe("hunkPatch", () => {
  const parsed = parseFilePatch("src/app.ts", PATCH)

  test("a single-hunk patch keeps the preamble and only that hunk", () => {
    const patch = hunkPatch(parsed, parsed.hunks[1])
    expect(patch).toContain("+++ b/src/app.ts")
    expect(patch).toContain("@@ -10,3 +10,4 @@")
    expect(patch).not.toContain("const b = 20")
    expect(patch.endsWith("\n")).toBe(true)
  })
})

describe("commentSteerText", () => {
  test("quotes the location and the comment", () => {
    expect(commentSteerText({ file: "src/app.ts", line: 12, comment: "Rename this to runJob", snippet: "const z = 3" })).toBe(
      "In src/app.ts at line 12:\n> const z = 3\nRename this to runJob",
    )
  })

  test("works without a snippet", () => {
    expect(commentSteerText({ file: "a.ts", line: 1, comment: "Why?" })).toBe("In a.ts at line 1\nWhy?")
  })
})
