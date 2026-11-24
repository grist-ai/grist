import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { InviteConfig } from "../invite-config.js"
import type { MemoryRecord } from "./types.js"
import {
  flushTeamMemoryPushes,
  loadTeamSyncState,
  mergeRecallHits,
  pullTeamMemory,
  queueTeamMemoryPush,
  recallTeamMemory,
  setTeamMemoryEnabled,
  teamSyncPath,
  type TeamSyncDeps,
} from "./team-sync.js"

const CONFIG: InviteConfig = { code: "invite-code-1", gatewayUrl: "http://gateway.test", kind: "invite" }

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "grist-team-sync-"))
}

function record(overrides?: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "mem_1",
    content: "Run bun test from the package dir; the repo root run is guarded and fails.",
    container: "repo-x",
    outcome: "tests_passed",
    weight: 0.75,
    createdAt: 1_700_000_000_000,
    metadata: { signature: "src/a.ts|bun test" },
    ...overrides,
  }
}

type PushRow = { id: string; result: string; reason?: string }

/**
 * In-memory stub of the gateway's team-memory endpoints (spec v2 §6 wire
 * shapes, as shipped in S1). Records every call so gating tests can prove
 * zero network traffic.
 */
function stubGateway(options?: {
  onPush?: (entries: MemoryRecord[]) => PushRow[]
  pullBody?: Record<string, unknown> | ((sinceSeq: number) => Record<string, unknown>)
  failPush?: boolean
  failPull?: boolean
}) {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const seenSignatures = new Set<string>()
  const fetchStub: typeof fetch = async (input, init) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    calls.push({ path: url, body })
    if (url.endsWith("/v1/team-memory/push")) {
      if (options?.failPush) throw new Error("network down")
      const entries = body.entries as MemoryRecord[]
      const results: PushRow[] =
        options?.onPush?.(entries) ??
        entries.map((entry) => {
          const signature = entry.metadata?.signature ?? ""
          if (seenSignatures.has(signature)) return { id: entry.id, result: "strengthened" }
          seenSignatures.add(signature)
          return { id: entry.id, result: "stored" }
        })
      return Response.json({ results })
    }
    if (url.endsWith("/v1/team-memory/pull")) {
      if (options?.failPull) throw new Error("network down")
      const sinceSeq = typeof body.since_seq === "number" ? body.since_seq : 0
      const payload =
        typeof options?.pullBody === "function"
          ? options.pullBody(sinceSeq)
          : (options?.pullBody ?? { entries: [], tombstones: [], next_seq: sinceSeq })
      return Response.json(payload)
    }
    return new Response("not found", { status: 404 })
  }
  return { calls, fetch: fetchStub, deps: { fetch: fetchStub, loadConfig: () => CONFIG } satisfies TeamSyncDeps }
}

function wireEntry(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "mem_remote_1",
    content: "The gateway store scopes every query by team_id.",
    container: "repo-x",
    outcome: "tests_passed",
    weight: 0.9,
    createdAt: 1_700_000_100_000,
    metadata: { signature: "src/store.ts|bun test" },
    author_user_id: "gu_teammate1",
    commit_sha: "abc123",
    code_refs: ["src/store.ts"],
    status: "active",
    seq: 3,
    superseded_by: null,
    ...overrides,
  }
}

describe("team memory opt-in gating (D2)", () => {
  test("no opt-in → queue is a no-op and nothing touches disk or network", async () => {
    const cwd = tempRepo()
    const gw = stubGateway()
    const queued = await queueTeamMemoryPush(cwd, record(), gw.deps)
    expect(queued).toBe("disabled")
    const push = await flushTeamMemoryPushes(cwd, gw.deps)
    const pull = await pullTeamMemory(cwd, gw.deps)
    expect(push.pending).toBe(0)
    expect(pull.pulled).toBe(0)
    expect(gw.calls).toHaveLength(0)
    expect(fs.existsSync(teamSyncPath(cwd))).toBe(false)
  })

  test("enable persists the flag; disable stops sync again", async () => {
    const cwd = tempRepo()
    const gw = stubGateway()
    await setTeamMemoryEnabled(cwd, true)
    expect((await loadTeamSyncState(cwd)).enabled).toBe(true)
    expect(await queueTeamMemoryPush(cwd, record(), gw.deps)).toBe("queued")
    await setTeamMemoryEnabled(cwd, false)
    const push = await flushTeamMemoryPushes(cwd, gw.deps)
    expect(push.attempted).toBe(0)
    expect(gw.calls).toHaveLength(0)
    // The queued entry survives disabling — it is a local capture.
    expect((await loadTeamSyncState(cwd)).pending).toHaveLength(1)
  })
})

describe("team memory push path", () => {
  test("stored and strengthened results update the journal; queue dedupes by id", async () => {
    const cwd = tempRepo()
    const gw = stubGateway()
    await setTeamMemoryEnabled(cwd, true)
    await queueTeamMemoryPush(cwd, record(), gw.deps)
    await queueTeamMemoryPush(cwd, record({ id: "mem_2" }), gw.deps) // same signature → strengthened
    expect(await queueTeamMemoryPush(cwd, record(), gw.deps)).toBe("duplicate")

    const summary = await flushTeamMemoryPushes(cwd, gw.deps)
    expect(summary).toMatchObject({ attempted: 2, stored: 1, strengthened: 1, rejected: 0, pending: 0 })

    const state = await loadTeamSyncState(cwd)
    expect(Object.keys(state.pushed).sort()).toEqual(["mem_1", "mem_2"])
    expect(state.lastPushAt).toBeTypeOf("number")
    expect(gw.calls).toHaveLength(1)
    expect((gw.calls[0]?.body.entries as unknown[]).length).toBe(2)
  })

  test("gateway rejections are terminal — marked in the journal, never retried", async () => {
    const cwd = tempRepo()
    const gw = stubGateway({
      onPush: (entries) => entries.map((entry) => ({ id: entry.id, result: "rejected", reason: "archived" })),
    })
    await setTeamMemoryEnabled(cwd, true)
    await queueTeamMemoryPush(cwd, record(), gw.deps)
    const first = await flushTeamMemoryPushes(cwd, gw.deps)
    expect(first.rejected).toBe(1)
    const state = await loadTeamSyncState(cwd)
    expect(state.rejected.mem_1?.reason).toBe("archived")
    expect(state.pending).toHaveLength(0)
    const second = await flushTeamMemoryPushes(cwd, gw.deps)
    expect(second.attempted).toBe(0)
    expect(gw.calls).toHaveLength(1)
    expect(await queueTeamMemoryPush(cwd, record(), gw.deps)).toBe("duplicate")
  })

  test("credential-shaped content is rejected at capture and never sent", async () => {
    const cwd = tempRepo()
    const gw = stubGateway()
    await setTeamMemoryEnabled(cwd, true)
    const secret = record({ content: "Deploy key is sk-proj-abcdefghijklmnopqrstuvwxyz0123456789 in CI." })
    expect(await queueTeamMemoryPush(cwd, secret, gw.deps)).toBe("rejected")
    const state = await loadTeamSyncState(cwd)
    expect(state.rejected.mem_1?.reason).toBe("secret_detected")
    expect(state.pending).toHaveLength(0)
    await flushTeamMemoryPushes(cwd, gw.deps)
    expect(gw.calls).toHaveLength(0)
  })

  test("offline push stays pending and lands on the next flush", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    await queueTeamMemoryPush(cwd, record(), { loadConfig: () => CONFIG })
    const down = stubGateway({ failPush: true })
    const failed = await flushTeamMemoryPushes(cwd, down.deps)
    expect(failed.error).toContain("network down")
    expect(failed.pending).toBe(1)
    expect((await loadTeamSyncState(cwd)).pending).toHaveLength(1)

    const up = stubGateway()
    const landed = await flushTeamMemoryPushes(cwd, up.deps)
    expect(landed).toMatchObject({ stored: 1, pending: 0 })
    expect((await loadTeamSyncState(cwd)).lastError).toBeUndefined()
  })

  test("no credential configured → pending stays queued, no calls attempted", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    await queueTeamMemoryPush(cwd, record(), { loadConfig: () => undefined })
    let calls = 0
    const summary = await flushTeamMemoryPushes(cwd, {
      loadConfig: () => undefined,
      fetch: (async () => {
        calls++
        throw new Error("must not be called")
      }) as typeof fetch,
    })
    expect(summary.error).toBe("not signed in")
    expect(summary.pending).toBe(1)
    expect(calls).toBe(0)
  })
})

describe("team memory pull path", () => {
  test("pull writes the mirror with provenance and advances the cursor only on success", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const gw = stubGateway({
      pullBody: (sinceSeq) =>
        sinceSeq === 0
          ? { entries: [wireEntry(), wireEntry({ id: "mem_remote_2", seq: 4 })], tombstones: [], next_seq: 4 }
          : { entries: [], tombstones: [], next_seq: 4 },
    })
    const first = await pullTeamMemory(cwd, gw.deps)
    expect(first).toMatchObject({ pulled: 2, cursor: 4 })
    const state = await loadTeamSyncState(cwd)
    expect(state.cursor).toBe(4)
    expect(state.mirror).toHaveLength(2)
    expect(state.mirror[0]?.authorUserId).toBe("gu_teammate1")
    expect(state.mirror[0]?.commitSha).toBe("abc123")

    const second = await pullTeamMemory(cwd, gw.deps)
    expect(second.pulled).toBe(0)
    expect(gw.calls[1]?.body.since_seq).toBe(4)
  })

  test("a failed pull leaves the cursor and mirror untouched", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const down = stubGateway({ failPull: true })
    const failed = await pullTeamMemory(cwd, down.deps)
    expect(failed.error).toContain("network down")
    const state = await loadTeamSyncState(cwd)
    expect(state.cursor).toBe(0)
    expect(state.mirror).toHaveLength(0)
  })

  test("tombstones remove mirrored entries", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const seed = stubGateway({ pullBody: { entries: [wireEntry()], tombstones: [], next_seq: 3 } })
    await pullTeamMemory(cwd, seed.deps)
    expect((await loadTeamSyncState(cwd)).mirror).toHaveLength(1)
    const sweep = stubGateway({ pullBody: { entries: [], tombstones: ["mem_remote_1"], next_seq: 5 } })
    const result = await pullTeamMemory(cwd, sweep.deps)
    expect(result.tombstoned).toBe(1)
    const state = await loadTeamSyncState(cwd)
    expect(state.mirror).toHaveLength(0)
    expect(state.cursor).toBe(5)
  })

  test("revoked clears the mirror, pauses sync, and re-enable resumes it", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const seed = stubGateway({ pullBody: { entries: [wireEntry()], tombstones: [], next_seq: 3 } })
    await pullTeamMemory(cwd, seed.deps)
    expect((await loadTeamSyncState(cwd)).mirror).toHaveLength(1)

    const revokedGw = stubGateway({ pullBody: { revoked: true, entries: [], tombstones: [], next_seq: 0 } })
    const result = await pullTeamMemory(cwd, revokedGw.deps)
    expect(result.revoked).toBe(true)
    const state = await loadTeamSyncState(cwd)
    expect(state.mirror).toHaveLength(0)
    expect(state.revoked).toBe(true)
    expect(state.cursor).toBe(0)

    // Paused: no further network traffic until re-enabled.
    const callsBefore = revokedGw.calls.length
    await pullTeamMemory(cwd, revokedGw.deps)
    await flushTeamMemoryPushes(cwd, revokedGw.deps)
    expect(revokedGw.calls.length).toBe(callsBefore)

    await setTeamMemoryEnabled(cwd, true)
    expect((await loadTeamSyncState(cwd)).revoked).toBe(false)
  })
})

describe("team recall merge (§8 + D5)", () => {
  test("mirror recall carries author attribution and demotes cross-container entries", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const gw = stubGateway({
      pullBody: {
        entries: [
          wireEntry({ id: "same", content: "gateway store scopes queries by team", container: "repo-x" }),
          wireEntry({ id: "cross", content: "gateway store scopes queries by team", container: "other-repo" }),
        ],
        tombstones: [],
        next_seq: 2,
      },
    })
    await pullTeamMemory(cwd, gw.deps)
    const state = await loadTeamSyncState(cwd)
    const hits = recallTeamMemory(state, { query: "gateway store", container: "repo-x", now: 1_700_000_100_000 })
    expect(hits).toHaveLength(2)
    expect(hits[0]?.id).toBe("same")
    expect(hits[0]?.team?.authorUserId).toBe("gu_teammate1")
    expect(hits[1]?.id).toBe("cross")
    expect(hits[1]?.score).toBeLessThan(hits[0]?.score ?? 0)
  })

  test("merge ranks across sources and enforces the shared token budget", () => {
    const big = "x".repeat(4000) // ~1000 tokens each
    const local = [
      { content: `local one ${big}`, score: 0.9 },
      { content: `local two ${big}`, score: 0.7 },
    ]
    const team = [
      { content: `team one ${big}`, score: 0.8, team: { authorUserId: "gu_teammate1" } },
      { content: `team two ${big}`, score: 0.6, team: { authorUserId: "gu_teammate1" } },
    ]
    const merged = mergeRecallHits({ local, team, budgetTokens: 2500 })
    expect(merged.map((hit) => hit.content.slice(0, 8))).toEqual(["local on", "team one"])
    const total = merged.reduce((sum, hit) => sum + Math.ceil(hit.content.length / 4) + 16, 0)
    expect(total).toBeLessThanOrEqual(2500)
    // Attribution survives the merge.
    expect(merged[1]?.team?.authorUserId).toBe("gu_teammate1")
  })

  test("merge always keeps the top hit even when it alone exceeds the budget", () => {
    const merged = mergeRecallHits({
      local: [{ content: "x".repeat(20000), score: 0.5 }],
      team: [],
      budgetTokens: 100,
    })
    expect(merged).toHaveLength(1)
  })
})
