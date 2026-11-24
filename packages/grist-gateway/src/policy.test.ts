import { Database } from "bun:sqlite"
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createGateway } from "./http.js"
import {
  runTeamMemoryPolicySweep,
  runTeamObjectPolicySweep,
  startTeamMemoryPolicy,
  teamMemoryPolicyConfig,
} from "./policy.js"
import { openGatewayStore } from "./store.js"

type Store = ReturnType<typeof openGatewayStore>
type Gateway = ReturnType<typeof createGateway>
type Account = { uid: string; userId: string; code: string }

const DAY = 86_400_000
const NO_DECAY = { retentionMs: 365 * DAY, decayFactor: 0.5 }

function makeAccount(store: Store, uid: string): Account {
  const invite = store.createInvite()
  const bound = store.bindAccount({ uid, email: `${uid}@example.com`, inviteCode: invite.code })
  if (!bound.ok) throw new Error(`bind failed for ${uid}`)
  const userId = bound.account.user_id
  if (!userId) throw new Error(`no user_id assigned for ${uid}`)
  return { uid, userId, code: invite.code }
}

function makeTeam(store: Store, owner: Account, members: Account[]): string {
  const created = store.createTeam({ ownerUid: owner.uid, name: "Core" })
  if (!created.ok) throw new Error("team create failed")
  for (const member of members) {
    const added = store.addTeamMember({
      teamId: created.team.id,
      actorUid: owner.uid,
      targetUserId: member.userId,
    })
    if (!added.ok) throw new Error("member add failed")
  }
  return created.team.id
}

type CallResult = { status: number; json: Record<string, unknown> }

async function call(
  gw: Gateway,
  path: string,
  code: string | undefined,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<CallResult> {
  const response = await gw.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(code ? { "X-Grist-Invite": code } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, json: (await response.json()) as Record<string, unknown> }
}

function entry(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "mem_1",
    content: "Run bun test from the package dir; the repo root run is guarded and fails.",
    container: "repo-x",
    outcome: "tests_passed",
    weight: 0.75,
    createdAt: 1_700_000_000_000,
    metadata: { signature: "src/a.ts,src/b.ts|bun test", commit_sha: "abc123" },
    ...overrides,
  }
}

async function push(gw: Gateway, code: string, entries: Record<string, unknown>[]) {
  const res = await call(gw, "/v1/team-memory/push", code, { entries })
  expect(res.status).toBe(200)
  return res
}

function rowsById(store: Store, teamId: string) {
  return new Map(store.listTeamMemory(teamId, { limit: 200 }).map((row) => [row.id, row]))
}

describe("policy config", () => {
  test("defaults, disable switch, and env overrides", () => {
    const dflt = teamMemoryPolicyConfig({})
    expect(dflt.disabled).toBe(false)
    expect(dflt.intervalMs).toBe(6 * 3_600_000)
    expect(dflt.retentionMs).toBe(90 * DAY)
    expect(dflt.decayFactor).toBe(0.9)

    expect(teamMemoryPolicyConfig({ GRIST_MEMORY_POLICY_INTERVAL_MS: "0" }).disabled).toBe(true)
    expect(teamMemoryPolicyConfig({ GRIST_MEMORY_POLICY_INTERVAL_MS: "off" }).disabled).toBe(true)
    expect(
      teamMemoryPolicyConfig({ GRIST_MEMORY_POLICY_INTERVAL_MS: "60000" }).intervalMs,
    ).toBe(60_000)
    // Garbage falls back to defaults rather than disabling or crashing.
    const garbage = teamMemoryPolicyConfig({
      GRIST_MEMORY_POLICY_INTERVAL_MS: "soon",
      GRIST_MEMORY_RETENTION_DAYS: "-3",
      GRIST_MEMORY_DECAY_FACTOR: "2",
    })
    expect(garbage.disabled).toBe(false)
    expect(garbage.intervalMs).toBe(dflt.intervalMs)
    expect(garbage.retentionMs).toBe(90 * DAY)
    expect(garbage.decayFactor).toBe(0.9)
  })

  test("scheduler honors the disable switch", () => {
    const store = openGatewayStore()
    expect(startTeamMemoryPolicy(store, { ...teamMemoryPolicyConfig({}), disabled: true })).toBeUndefined()
    const handle = startTeamMemoryPolicy(store, {
      intervalMs: 3_600_000,
      retentionMs: DAY,
      decayFactor: 0.9,
      disabled: false,
    })
    expect(handle).toBeDefined()
    handle?.stop()
  })
})

describe("team memory policy sweep", () => {
  test("merges a duplicate pair: strengthen + supersede + archive, audited, summarized", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])

    // Same lesson, captured independently: different signature, cosmetic
    // content differences, B verified it later against a newer commit.
    await push(gw, a.code, [entry()])
    await push(gw, b.code, [
      entry({
        id: "mem_2",
        content: "  run bun test from the package dir; the repo root run is guarded and fails.\n",
        weight: 0.5,
        createdAt: 1_700_000_060_000,
        metadata: { signature: "src/c.ts|bun test", commit_sha: "def456" },
      }),
    ])
    expect(rowsById(store, teamId).size).toBe(2)

    const now = Date.now()
    const sweep = runTeamMemoryPolicySweep(store, { now, ...NO_DECAY })
    expect(sweep.totals).toEqual({ merged: 1, flagged: 0, decayed: 0, archived: 1 })

    const rows = rowsById(store, teamId)
    const winner = rows.get("mem_1")
    const loser = rows.get("mem_2")
    expect(winner?.status).toBe("active")
    expect(winner?.weight).toBe(1.25)
    expect(winner?.commit_sha).toBe("def456")
    const winnerMeta = JSON.parse(winner?.metadata ?? "{}") as { also_verified_by?: string[] }
    expect(winnerMeta.also_verified_by).toEqual([b.userId])
    expect(loser?.status).toBe("archived")
    expect(loser?.superseded_by).toBe("mem_1")

    // The merge travels the pull feed: winner as content, loser as tombstone.
    const pulled = store.pullTeamMemory(teamId, 0)
    expect(pulled.entries.map((row) => row.id)).toEqual(["mem_1"])
    expect(pulled.tombstones).toEqual(["mem_2"])

    // Every action is audited under the job's actor, and audit rows carry
    // no entry bodies — structurally, there is no body field at all.
    const audit = store.teamMemoryAudit(teamId).filter((row) => row.actor_uid === "dreaming")
    expect(audit.map((row) => row.action).sort()).toEqual(["archive", "strengthen", "supersede"])
    expect(audit.find((row) => row.action === "strengthen")?.entry_id).toBe("mem_1")
    expect(audit.find((row) => row.action === "supersede")?.entry_id).toBe("mem_2")
    for (const row of audit) {
      expect(Object.keys(row).sort()).toEqual([
        "action",
        "actor_uid",
        "at",
        "entry_id",
        "id",
        "kind",
        "team_id",
      ])
      // Memory actions are tagged with their kind on the one shared
      // trail (filesystem spec v1 §4).
      expect(row.kind).toBe("memory")
    }

    // The run summary is recorded for the dashboard.
    expect(store.getDreamingRun(teamId)).toEqual({
      at: now,
      merged: 1,
      flagged: 0,
      decayed: 0,
      archived: 1,
    })

    // Idempotent: a second sweep at the same instant changes nothing.
    const auditCount = store.teamMemoryAudit(teamId).length
    const again = runTeamMemoryPolicySweep(store, { now, ...NO_DECAY })
    expect(again.totals).toEqual({ merged: 0, flagged: 0, decayed: 0, archived: 0 })
    expect(store.teamMemoryAudit(teamId).length).toBe(auditCount)
    expect(rowsById(store, teamId).get("mem_1")?.weight).toBe(1.25)
  })

  test("flags entries superseded by newer verification of the same code — flag only", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])
    const t0 = 1_700_000_000_000

    await push(gw, a.code, [
      entry({
        id: "stale_1",
        content: "First lesson about the parser.",
        createdAt: t0,
        metadata: { signature: "src/a.ts|bun test", commit_sha: "aaa111" },
      }),
      // Disjoint code refs: never flagged, however new the other entry is.
      entry({
        id: "solo_1",
        content: "A lesson about z.",
        createdAt: t0,
        metadata: { signature: "src/z.ts|bun test", commit_sha: "ccc333" },
      }),
      // Same commit as its newer sibling: not stale.
      entry({
        id: "same_1",
        content: "A lesson about q.",
        createdAt: t0,
        metadata: { signature: "src/q.ts|bun test", commit_sha: "eee555" },
      }),
    ])
    await push(gw, b.code, [
      entry({
        id: "fresh_1",
        content: "Second lesson about the parser.",
        createdAt: t0 + 60_000,
        metadata: { signature: "src/a.ts|bun run check", commit_sha: "bbb222" },
      }),
      entry({
        id: "solo_2",
        content: "A lesson about y.",
        createdAt: t0 + 60_000,
        metadata: { signature: "src/y.ts|bun test", commit_sha: "ddd444" },
      }),
      entry({
        id: "same_2",
        content: "Another lesson about q.",
        createdAt: t0 + 60_000,
        metadata: { signature: "src/q.ts|bun run check", commit_sha: "eee555" },
      }),
    ])

    const sweep = runTeamMemoryPolicySweep(store, { now: Date.now(), ...NO_DECAY })
    expect(sweep.totals.flagged).toBe(1)
    expect(sweep.totals.merged).toBe(0)

    const rows = rowsById(store, teamId)
    expect(rows.get("stale_1")?.status).toBe("flagged")
    // Flag only: content and row survive intact, and it is not a removal —
    // no tombstone carries it.
    expect(rows.get("stale_1")?.content).toBe("First lesson about the parser.")
    expect(rows.get("fresh_1")?.status).toBe("active")
    expect(rows.get("solo_1")?.status).toBe("active")
    expect(rows.get("same_1")?.status).toBe("active")
    expect(store.pullTeamMemory(teamId, 0).tombstones).not.toContain("stale_1")
    const audit = store.teamMemoryAudit(teamId).filter((row) => row.actor_uid === "dreaming")
    expect(audit).toHaveLength(1)
    expect(audit[0]?.action).toBe("flag")
    expect(audit[0]?.entry_id).toBe("stale_1")
  })

  test("decays inactive weights once per window, archives zero-weight entries past it", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const teamId = makeTeam(store, a, [])
    await push(gw, a.code, [entry({ id: "mem_decay", weight: 0.5 })])
    await push(gw, a.code, [
      entry({
        id: "mem_zero",
        content: "A zero-weight lesson.",
        weight: 0,
        metadata: { signature: "src/z.ts|bun test", commit_sha: "abc123" },
      }),
    ])

    const now = Date.now() + 100 * DAY
    const opts = { now, retentionMs: 90 * DAY, decayFactor: 0.5 }
    const first = runTeamMemoryPolicySweep(store, opts)
    expect(first.totals).toEqual({ merged: 0, flagged: 0, decayed: 1, archived: 1 })
    const rows = rowsById(store, teamId)
    expect(rows.get("mem_decay")?.weight).toBe(0.25)
    expect(rows.get("mem_decay")?.status).toBe("active")
    expect(rows.get("mem_zero")?.status).toBe("archived")

    // One decay step per window: an immediate repeat is a no-op.
    const second = runTeamMemoryPolicySweep(store, opts)
    expect(second.totals).toEqual({ merged: 0, flagged: 0, decayed: 0, archived: 0 })
    expect(rowsById(store, teamId).get("mem_decay")?.weight).toBe(0.25)

    // After another full window of inactivity it decays again.
    const third = runTeamMemoryPolicySweep(store, { ...opts, now: now + 100 * DAY })
    expect(third.totals.decayed).toBe(1)
    expect(rowsById(store, teamId).get("mem_decay")?.weight).toBe(0.125)
  })

  test("a leaver's entries stay and are untouched by the sweep", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])
    await push(gw, b.code, [entry({ id: "mem_leaver" })])
    expect(store.removeTeamMember({ teamId, actorUid: a.uid, targetUid: b.uid })).toEqual({
      ok: true,
    })

    const sweep = runTeamMemoryPolicySweep(store, { now: Date.now(), ...NO_DECAY })
    expect(sweep.totals).toEqual({ merged: 0, flagged: 0, decayed: 0, archived: 0 })
    const row = rowsById(store, teamId).get("mem_leaver")
    expect(row?.status).toBe("active")
    expect(row?.author_user_id).toBe(b.userId)
  })

  test("list carries team-wide counts and the last curation run", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    makeTeam(store, a, [b])
    await push(gw, a.code, [entry()])
    await push(gw, b.code, [
      entry({
        id: "mem_2",
        content: "run bun test from the package dir; the repo root run is guarded and fails.",
        weight: 0.5,
        metadata: { signature: "src/c.ts|bun test", commit_sha: "def456" },
      }),
    ])

    const before = await call(gw, "/v1/team-memory/list", a.code, {})
    expect(before.status).toBe(200)
    const beforeCounts = before.json.counts as { total: number; byOutcome: Record<string, number> }
    expect(beforeCounts.total).toBe(2)
    expect(beforeCounts.byOutcome).toEqual({ tests_passed: 2 })
    expect(before.json.dreaming).toBeNull()

    const now = Date.now()
    runTeamMemoryPolicySweep(store, { now, ...NO_DECAY })
    const after = await call(gw, "/v1/team-memory/list", a.code, {})
    const counts = after.json.counts as {
      total: number
      byStatus: Record<string, number>
    }
    expect(counts.total).toBe(2)
    expect(counts.byStatus).toEqual({ active: 1, archived: 1 })
    expect(after.json.dreaming).toEqual({
      at: now,
      merged: 1,
      flagged: 0,
      decayed: 0,
      archived: 1,
    })
    const entries = after.json.entries as { id: string; updated_at: number }[]
    expect(entries.every((row) => typeof row.updated_at === "number")).toBe(true)
  })
})

describe("object policy sweep (filesystem spec v1 §7 partition)", () => {
  function skillObj(overrides?: Record<string, unknown>): Record<string, unknown> {
    return {
      id: "obj_1",
      kind: "skill",
      container: "repo-x",
      name: "deploy-check",
      body: "Verify the deploy: run the smoke suite, then check the health endpoint.",
      metadata: { description: "Pre-deploy verification checklist" },
      ...overrides,
    }
  }

  async function pushObjects(gw: Gateway, code: string, objects: Record<string, unknown>[]) {
    const res = await call(gw, "/v1/team-objects/push", code, { objects })
    expect(res.status).toBe(200)
    return res
  }

  function objectRowsById(store: Store, teamId: string) {
    return new Map(
      store.listTeamObjects(teamId, { uid: "sweep-test" }, { limit: 200 }).map((row) => [row.id, row]),
    )
  }

  test("archives a superseded skill with a skill-kind audit row; the head stays current", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])

    await pushObjects(gw, a.code, [skillObj()])
    await pushObjects(gw, b.code, [
      skillObj({ id: "obj_2", body: "Verify the deploy: run the full suite first.", supersedes: "obj_1" }),
    ])
    // Push deliberately leaves the superseded head active (S-FS1); the
    // sweep is what closes the loop.
    expect(objectRowsById(store, teamId).get("obj_1")?.status).toBe("active")

    const now = Date.now()
    const sweep = runTeamObjectPolicySweep(store, { now })
    expect(sweep.totals).toEqual({ archived: 1, flagged: 0 })
    expect(sweep.teams.find((team) => team.teamId === teamId)?.byKind).toEqual({
      skill: { archived: 1, flagged: 0 },
    })

    const rows = objectRowsById(store, teamId)
    expect(rows.get("obj_1")?.status).toBe("archived")
    expect(rows.get("obj_2")?.status).toBe("active")

    // The archive travels the objects pull feed as a tombstone; the
    // head is the only content.
    const pulled = store.pullTeamObjects(teamId, { uid: a.uid }, 0)
    expect(pulled.objects.map((row) => row.id)).toEqual(["obj_2"])
    expect(pulled.tombstones).toEqual(["obj_1"])

    // Audited under the job's actor, tagged with the object's kind.
    const audit = store
      .teamMemoryAudit(teamId)
      .filter((row) => row.actor_uid === "dreaming")
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ kind: "skill", action: "archive", entry_id: "obj_1" })

    // The run summary is recorded for the dashboard, kinds split out.
    expect(store.getObjectDreamingRun(teamId)).toEqual({
      at: now,
      archived: 1,
      flagged: 0,
      byKind: { skill: { archived: 1, flagged: 0 } },
    })

    // Idempotent: a second sweep at the same instant changes nothing.
    const auditCount = store.teamMemoryAudit(teamId).length
    const again = runTeamObjectPolicySweep(store, { now })
    expect(again.totals).toEqual({ archived: 0, flagged: 0 })
    expect(store.teamMemoryAudit(teamId).length).toBe(auditCount)
  })

  test("never merges near-duplicate skills — while memory duplicates still merge in the same cycle", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])

    // Two DISTINCT skills with byte-identical bodies (different names,
    // so different chains). Memory's merge keys on normalized content
    // text within a container — applied to objects, it would fuse
    // these into one. The partition must not let it.
    const body = "Always run the smoke suite before declaring the deploy done."
    await pushObjects(gw, a.code, [
      skillObj({ id: "sk_a", name: "deploy-check", body, metadata: { description: "Deploy check" } }),
      skillObj({ id: "sk_b", name: "release-check", body, metadata: { description: "Release check" } }),
    ])
    // And a genuine memory duplicate pair, to prove the memory side of
    // the partition still does its job in the same sweep cycle.
    await push(gw, a.code, [entry()])
    await push(gw, b.code, [
      entry({
        id: "mem_2",
        content: "  run bun test from the package dir; the repo root run is guarded and fails.\n",
        weight: 0.5,
        metadata: { signature: "src/c.ts|bun test", commit_sha: "def456" },
      }),
    ])

    runTeamMemoryPolicySweep(store, { now: Date.now(), ...NO_DECAY })
    const objects = runTeamObjectPolicySweep(store, { now: Date.now() })
    expect(objects.totals).toEqual({ archived: 0, flagged: 0 })

    const rows = objectRowsById(store, teamId)
    expect(rows.get("sk_a")?.status).toBe("active")
    expect(rows.get("sk_b")?.status).toBe("active")
    expect(rows.get("sk_a")?.supersedes).toBeNull()
    expect(rows.get("sk_b")?.supersedes).toBeNull()

    // Memory merged as always; not one dreaming action touched a skill.
    const memory = rowsById(store, teamId)
    expect(memory.get("mem_1")?.weight).toBe(1.25)
    expect(memory.get("mem_2")?.status).toBe("archived")
    const audit = store.teamMemoryAudit(teamId).filter((row) => row.actor_uid === "dreaming")
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.every((row) => row.kind === "memory")).toBe(true)
  })

  test("flags a head whose supersedes target is missing — chain integrity, not silent trust", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grist-fs-integrity-"))
    const file = path.join(dir, "gateway.db")
    try {
      const store = openGatewayStore(file)
      const a = makeAccount(store, "uid_a")
      const teamId = makeTeam(store, a, [])
      const actor = { uid: a.uid, userId: a.userId }
      const root = store.pushTeamObject(teamId, actor, {
        id: "obj_root",
        kind: "skill",
        container: "repo-x",
        name: "deploy-check",
        body: "Verify the deploy.",
        metadata: { description: "Pre-deploy verification checklist" },
        supersedes: null,
      })
      expect(root.status).toBe("stored")
      const head = store.pushTeamObject(teamId, actor, {
        id: "obj_head",
        kind: "skill",
        container: "repo-x",
        name: "deploy-check",
        body: "Verify the deploy: full suite.",
        metadata: { description: "Pre-deploy verification checklist" },
        supersedes: "obj_root",
      })
      expect(head.status).toBe("stored")

      // Corruption the API cannot produce (push rejects dangling
      // pointers and rows are never deleted): the chain root vanishes.
      const raw = new Database(file)
      raw.run("DELETE FROM team_objects WHERE id = ?", ["obj_root"])
      raw.close()

      const now = Date.now()
      const sweep = runTeamObjectPolicySweep(store, { now })
      expect(sweep.totals).toEqual({ archived: 0, flagged: 1 })
      const rows = objectRowsById(store, teamId)
      expect(rows.get("obj_head")?.status).toBe("flagged")
      const audit = store
        .teamMemoryAudit(teamId)
        .filter((row) => row.actor_uid === "dreaming")
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({ kind: "skill", action: "flag", entry_id: "obj_head" })

      // Flagged is terminal for the sweep: no re-flag, no archive.
      const again = runTeamObjectPolicySweep(store, { now })
      expect(again.totals).toEqual({ archived: 0, flagged: 0 })
      expect(store.teamMemoryAudit(teamId).length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("dashboard team memory surface", () => {
  const USERS: Record<string, { localId: string; email: string }> = {
    tok_a: { localId: "uid_a", email: "a@example.com" },
    tok_b: { localId: "uid_b", email: "b@example.com" },
  }
  process.env.FIREBASE_API_KEY = "test-key"
  process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
  process.env.FIREBASE_PROJECT_ID = "grist-test"
  process.env.FIREBASE_APP_ID = "1:1:web:abc"
  afterAll(() => {
    delete process.env.FIREBASE_API_KEY
    delete process.env.FIREBASE_AUTH_DOMAIN
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_APP_ID
  })

  function gateway(store: Store): Gateway {
    return createGateway({
      store,
      fetch: async (_input: string, init?: RequestInit) => {
        const token = (JSON.parse(String(init?.body)) as { idToken?: string }).idToken ?? ""
        const user = USERS[token]
        return new Response(JSON.stringify({ users: user ? [user] : [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      },
    })
  }

  test("list + remove round-trip on the dashboard's Bearer Firebase auth", async () => {
    const store = openGatewayStore()
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])
    const gw = gateway(store)
    await push(gw, a.code, [entry()])

    // Exactly the dashboard's shape: POST JSON with a Bearer ID token.
    const listed = await call(gw, "/v1/team-memory/list", undefined, {}, {
      Authorization: "Bearer tok_b",
    })
    expect(listed.status).toBe(200)
    expect(listed.json.entries).toHaveLength(1)
    expect(listed.json.counts).toBeDefined()
    expect(listed.json.dreaming).toBeNull()

    // A member who is not the author cannot remove it — the endpoint
    // enforces, and the dashboard surfaces this failure honestly.
    const denied = await call(gw, "/v1/team-memory/remove", undefined, { id: "mem_1" }, {
      Authorization: "Bearer tok_b",
    })
    expect(denied.status).toBe(403)

    const removed = await call(gw, "/v1/team-memory/remove", undefined, { id: "mem_1" }, {
      Authorization: "Bearer tok_a",
    })
    expect(removed.status).toBe(200)
    expect(rowsById(store, teamId).get("mem_1")?.status).toBe("archived")
  })

  test("the served dashboard page carries the memory browser", async () => {
    const gw = gateway(openGatewayStore())
    const response = await gw.fetch(new Request("http://localhost/dashboard/team"))
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('id="team-memory-list"')
    expect(html).toContain('id="team-memory-filter"')
    expect(html).toContain('id="team-memory-summary"')
    expect(html).toContain('id="team-memory-dreaming"')
  })

  test("the served dashboard page carries the filesystem kind switcher", async () => {
    const gw = gateway(openGatewayStore())
    const response = await gw.fetch(new Request("http://localhost/dashboard/team"))
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('id="team-fs-summary"')
    expect(html).toContain('data-fs-kind="memory"')
    expect(html).toContain('data-fs-kind="skill"')
    expect(html).toContain('data-fs-kind="agent_definition"')
    expect(html).toContain('data-fs-kind="artifact"')
    expect(html).toContain('id="team-memory-panel"')
    expect(html).toContain('id="team-objects-panel"')
    expect(html).toContain('id="team-objects-list"')
    expect(html).toContain('id="team-objects-filter"')
  })

  test("objects list + remove round-trip on the dashboard's Bearer Firebase auth", async () => {
    const store = openGatewayStore()
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])
    const gw = gateway(store)
    const pushed = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [
        {
          id: "obj_1",
          kind: "skill",
          container: "repo-x",
          name: "deploy-check",
          body: "Verify the deploy: run the smoke suite, then check the health endpoint.",
          metadata: { description: "Pre-deploy verification checklist" },
        },
      ],
    })
    expect(pushed.status).toBe(200)

    // Exactly the dashboard's shape: POST JSON with a Bearer ID token.
    const listed = await call(gw, "/v1/team-objects/list", undefined, { kind: "skill" }, {
      Authorization: "Bearer tok_b",
    })
    expect(listed.status).toBe(200)
    const objects = listed.json.objects as { id: string; is_head: boolean }[]
    expect(objects).toHaveLength(1)
    expect(objects[0]?.is_head).toBe(true)
    const counts = listed.json.counts as { total: number; byKind: Record<string, number> }
    expect(counts.total).toBe(1)
    expect(counts.byKind).toEqual({ skill: 1 })
    expect(listed.json.dreaming).toBeNull()

    // A member who is not the author cannot remove it — the endpoint
    // enforces, and the dashboard surfaces this failure honestly.
    const denied = await call(gw, "/v1/team-objects/remove", undefined, { id: "obj_1" }, {
      Authorization: "Bearer tok_b",
    })
    expect(denied.status).toBe(403)

    const removed = await call(gw, "/v1/team-objects/remove", undefined, { id: "obj_1" }, {
      Authorization: "Bearer tok_a",
    })
    expect(removed.status).toBe(200)
    const rows = store.listTeamObjects(teamId, { uid: a.uid }, {})
    expect(rows.find((row) => row.id === "obj_1")?.status).toBe("archived")
  })
})
