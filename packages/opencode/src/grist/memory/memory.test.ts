import { describe, expect, test } from "bun:test"
import { createFileStore } from "./file-store"
import { formatHits } from "./format"
import { decayScore, isVerifiedOutcome, requireVerified } from "./verified"

describe("memory verified gate", () => {
  test("allows only verified outcomes", () => {
    expect(isVerifiedOutcome("tests_passed")).toBe(true)
    expect(isVerifiedOutcome("user_approved")).toBe(true)
    expect(isVerifiedOutcome("user_corrected")).toBe(true)
  })

  test("requireVerified drops empty and unverified", () => {
    expect(
      requireVerified({
        content: "use bun not npm",
        container: "prosh",
        outcome: "tests_passed",
      }),
    ).toBeDefined()
    expect(
      requireVerified({
        content: "   ",
        container: "prosh",
        outcome: "tests_passed",
      }),
    ).toBeUndefined()
  })
})

describe("memory file store", () => {
  test("remembers verified and recalls by keyword", async () => {
    const files = new Map<string, string>()
    const store = createFileStore({
      filePath: "/tmp/grist-memory-test.json",
      readFile: async (p) => {
        const hit = files.get(p)
        if (!hit) throw new Error("missing")
        return hit
      },
      writeFile: async (p, text) => {
        files.set(p, text)
      },
      mkdir: async () => {},
    })

    const saved = await store.remember({
      content: "Auth lives in src/auth.ts; sessions use createSession.",
      container: "prosh",
      outcome: "tests_passed",
    })
    expect(saved?.id).toBeDefined()

    const hits = await store.recall({ query: "createSession", container: "prosh" })
    expect(hits.length).toBe(1)
    expect(hits[0]!.content).toContain("createSession")

    const miss = await store.recall({ query: "createSession", container: "other" })
    expect(miss.length).toBe(0)
  })

  test("rejects empty remember", async () => {
    const store = createFileStore({
      filePath: "/tmp/x.json",
      readFile: async () => JSON.stringify({ records: [] }),
      writeFile: async () => {},
      mkdir: async () => {},
    })
    const rejected = await store.remember({
      content: "  ",
      container: "prosh",
      outcome: "tests_passed",
    })
    expect(rejected).toBeUndefined()
  })
})

describe("memory helpers", () => {
  test("decayScore prefers recent high-weight records", () => {
    const now = Date.now()
    const fresh = decayScore(
      {
        id: "1",
        content: "a",
        container: "c",
        outcome: "user_corrected",
        weight: 1,
        createdAt: now,
      },
      now,
    )
    const stale = decayScore(
      {
        id: "2",
        content: "b",
        container: "c",
        outcome: "tests_passed",
        weight: 0.75,
        createdAt: now - 90 * 24 * 60 * 60 * 1000,
      },
      now,
    )
    expect(fresh).toBeGreaterThan(stale)
  })

  test("formatHits renders empty and non-empty", () => {
    expect(formatHits({ query: "x", hits: [], backend: "file" })).toContain("hits=0")
    expect(
      formatHits({
        query: "auth",
        backend: "file",
        hits: [{ content: "use jwt", score: 0.9, outcome: "tests_passed" }],
      }),
    ).toContain("use jwt")
  })
})
