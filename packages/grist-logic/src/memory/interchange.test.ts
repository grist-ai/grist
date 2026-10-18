import { describe, expect, test } from "bun:test"
import { parseMemoryRepo, renderMemoryRepo } from "./interchange.js"
import type { MemoryRecord } from "./types.js"

const record: MemoryRecord = {
  id: "abc123",
  content: "Deploy pipeline is owned by Akhil; changes need the runbook in docs/deploy.md",
  container: "necora",
  outcome: "user_corrected",
  weight: 1,
  createdAt: Date.UTC(2026, 9, 18, 10, 0, 0),
  sessionID: "ses_42",
  metadata: { topic: "ownership" },
}

describe("Agent Memory Repo interchange", () => {
  test("render produces an index with [[links]] and [source; added] metadata", () => {
    const files = renderMemoryRepo([record], "necora")
    const index = files.find((f) => f.path === "MEMORY.md")
    expect(index?.text).toContain("[[memories/abc123.md]]")
    expect(index?.text).toContain("[source: ses_42; added: 2026-10-18]")
    const body = files.find((f) => f.path === "memories/abc123.md")
    expect(body?.text).toContain("outcome: user_corrected")
    expect(body?.text).toContain(record.content)
  })

  test("render → parse round-trips a verified record", () => {
    const parsed = parseMemoryRepo(renderMemoryRepo([record], "necora"))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.content).toBe(record.content)
    expect(parsed[0]?.container).toBe("necora")
    expect(parsed[0]?.outcome).toBe("user_corrected")
    expect(parsed[0]?.verified).toBe(true)
    expect(parsed[0]?.sessionID).toBe("ses_42")
    expect(parsed[0]?.metadata).toEqual({ topic: "ownership" })
  })

  test("records without a verified outcome header come back flagged", () => {
    const files = [
      { path: "MEMORY.md", text: "# Memory — x\n\n- [[memories/m1.md]] note [source: s; added: 2026-10-18]\n" },
      { path: "memories/m1.md", text: "container: x\n\nSome imported note without provenance." },
    ]
    const parsed = parseMemoryRepo(files)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.verified).toBe(false)
  })

  test("missing index yields no imports", () => {
    expect(parseMemoryRepo([])).toEqual([])
  })
})
