import { describe, expect, test } from "bun:test"
import { createFileStore } from "./file-store"
import { formatHits } from "./format"
import { resolveSupermemoryBinary } from "./ensure-local"
import { createSupermemoryStore, shouldUseSupermemory } from "./supermemory-store"
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

describe("supermemory local client", () => {
  test("shouldUseSupermemory respects env", () => {
    const prev = {
      key: process.env.SUPERMEMORY_API_KEY,
      base: process.env.SUPERMEMORY_BASE_URL,
      url: process.env.SUPERMEMORY_API_URL,
      mode: process.env.GRIST_MEMORY,
    }
    try {
      delete process.env.SUPERMEMORY_API_KEY
      delete process.env.SUPERMEMORY_BASE_URL
      delete process.env.SUPERMEMORY_API_URL
      delete process.env.GRIST_MEMORY
      expect(shouldUseSupermemory()).toBe(false)
      process.env.GRIST_MEMORY = "supermemory"
      expect(shouldUseSupermemory()).toBe(true)
      process.env.GRIST_MEMORY = "file"
      expect(shouldUseSupermemory()).toBe(false)
    } finally {
      if (prev.key === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = prev.key
      if (prev.base === undefined) delete process.env.SUPERMEMORY_BASE_URL
      else process.env.SUPERMEMORY_BASE_URL = prev.base
      if (prev.url === undefined) delete process.env.SUPERMEMORY_API_URL
      else process.env.SUPERMEMORY_API_URL = prev.url
      if (prev.mode === undefined) delete process.env.GRIST_MEMORY
      else process.env.GRIST_MEMORY = prev.mode
    }
  })

  test("maps v4 search memory field", async () => {
    const store = createSupermemoryStore({
      apiKey: "sm_test",
      baseURL: "http://localhost:9",
      allowUnauthenticated: true,
      fetch: (async (_url, init) => {
        const path = String(_url)
        if (path.endsWith("/v4/search")) {
          return new Response(
            JSON.stringify({
              results: [{ id: "1", memory: "prefers bun", similarity: 0.9 }],
              total: 1,
            }),
            { status: 200 },
          )
        }
        if (path.endsWith("/v3/documents") && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "doc1", status: "queued" }), { status: 200 })
        }
        return new Response("no", { status: 404 })
      }) as typeof fetch,
    })
    expect(store).toBeDefined()
    const hits = await store!.recall({ query: "bun", container: "grist" })
    expect(hits).toEqual([{ content: "prefers bun", score: 0.9, id: "1" }])
  })
})

describe("supermemory binary resolve", () => {
  test("resolveSupermemoryBinary finds installed path or undefined", () => {
    const bin = resolveSupermemoryBinary()
    if (bin) expect(bin).toContain("supermemory")
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
