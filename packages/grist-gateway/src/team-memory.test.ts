import { describe, expect, test } from "bun:test"
import { createGateway } from "./http.js"
import { findSecretKind } from "./secrets-scan.js"
import { openGatewayStore } from "./store.js"

type Store = ReturnType<typeof openGatewayStore>
type Gateway = ReturnType<typeof createGateway>

type Account = { uid: string; userId: string; code: string }

function makeAccount(store: Store, uid: string): Account {
  const invite = store.createInvite()
  const bound = store.bindAccount({ uid, email: `${uid}@example.com`, inviteCode: invite.code })
  if (!bound.ok) throw new Error(`bind failed for ${uid}`)
  const userId = bound.account.user_id
  if (!userId) throw new Error(`no user_id assigned for ${uid}`)
  return { uid, userId, code: invite.code }
}

function makeTeam(store: Store, owner: Account, members: Account[], name = "Core"): string {
  const created = store.createTeam({ ownerUid: owner.uid, name })
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

type ResultRow = { id: string | null; result: string; reason?: string }
type PulledEntry = {
  id: string
  content: string
  author_user_id: string
  weight: number
  status: string
  seq: number
  metadata: Record<string, string>
  code_refs: string[]
  commit_sha: string | null
}

function results(res: CallResult): ResultRow[] {
  return res.json.results as ResultRow[]
}

function pulled(res: CallResult): PulledEntry[] {
  return res.json.entries as PulledEntry[]
}

describe("team memory sync", () => {
  test("push → pull round-trip across two members, with attribution and cursor", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    makeTeam(store, a, [b])

    const push = await call(gw, "/v1/team-memory/push", a.code, {
      entries: [entry(), entry({ id: "mem_2", metadata: { signature: "src/c.ts|bun test" } })],
    })
    expect(push.status).toBe(200)
    expect(results(push)).toEqual([
      { id: "mem_1", result: "stored" },
      { id: "mem_2", result: "stored" },
    ])

    const first = await call(gw, "/v1/team-memory/pull", b.code, { since_seq: 0 })
    expect(first.status).toBe(200)
    const entries = pulled(first)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.author_user_id).toBe(a.userId)
    expect(entries[0]?.content).toContain("package dir")
    expect(entries[0]?.code_refs).toEqual(["src/a.ts", "src/b.ts"])
    expect(entries[0]?.commit_sha).toBe("abc123")
    expect(first.json.next_seq).toBe(2)
    expect(first.json.tombstones).toEqual([])

    // The cursor makes the next pull empty.
    const second = await call(gw, "/v1/team-memory/pull", b.code, { since_seq: 2 })
    expect(pulled(second)).toEqual([])
    expect(second.json.next_seq).toBe(2)

    // Pull also works authenticated by a member's own API key.
    const key = store.createApiKey({ inviteCode: b.code })
    if (!key) throw new Error("key mint failed")
    const byKey = await call(gw, "/v1/team-memory/pull", undefined, { since_seq: 0 }, {
      "X-Grist-Api-Key": key.secret,
    })
    expect(byKey.status).toBe(200)
    expect(pulled(byKey)).toHaveLength(2)
  })

  test("pull can scope to containers", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    makeTeam(store, a, [b])
    await call(gw, "/v1/team-memory/push", a.code, {
      entries: [
        entry(),
        entry({ id: "mem_other", container: "repo-y", metadata: { signature: "src/z.ts|bun test" } }),
      ],
    })
    const scoped = await call(gw, "/v1/team-memory/pull", b.code, {
      since_seq: 0,
      containers: ["repo-y"],
    })
    const entries = pulled(scoped)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe("mem_other")
  })

  test("cross-team isolation: no reads, no removes, no strengthening across teams", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const c = makeAccount(store, "uid_c")
    const d = makeAccount(store, "uid_d")
    makeTeam(store, a, [b], "One")
    makeTeam(store, c, [d], "Two")

    await call(gw, "/v1/team-memory/push", a.code, { entries: [entry()] })

    // Team Two sees nothing of Team One.
    const foreign = await call(gw, "/v1/team-memory/pull", d.code, { since_seq: 0 })
    expect(pulled(foreign)).toEqual([])
    expect(foreign.json.next_seq).toBe(0)
    const foreignList = await call(gw, "/v1/team-memory/list", d.code, {})
    expect(pulled(foreignList)).toEqual([])

    // A remove aimed at Team One's entry id is a 404 in Team Two — the id
    // does not exist in the caller's team scope.
    const foreignRemove = await call(gw, "/v1/team-memory/remove", d.code, { id: "mem_1" })
    expect(foreignRemove.status).toBe(404)

    // The same signature pushed in Team Two stores independently — it does
    // not strengthen (or even see) Team One's row.
    const own = await call(gw, "/v1/team-memory/push", d.code, { entries: [entry({ id: "mem_t2" })] })
    expect(results(own)).toEqual([{ id: "mem_t2", result: "stored" }])
    const oneList = await call(gw, "/v1/team-memory/list", a.code, {})
    expect(pulled(oneList)).toHaveLength(1)
    expect(pulled(oneList)[0]?.weight).toBeCloseTo(0.75)
  })

  test("duplicate signature strengthens: weight grows, verifier recorded, still one row", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    makeTeam(store, a, [b])

    await call(gw, "/v1/team-memory/push", a.code, { entries: [entry()] })
    const before = await call(gw, "/v1/team-memory/pull", b.code, { since_seq: 0 })
    const cursor = before.json.next_seq as number

    const again = await call(gw, "/v1/team-memory/push", b.code, {
      entries: [entry({ id: "mem_1_recheck" })],
    })
    expect(results(again)).toEqual([{ id: "mem_1_recheck", result: "strengthened" }])

    const list = await call(gw, "/v1/team-memory/list", a.code, {})
    const rows = pulled(list)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe("mem_1")
    expect(rows[0]?.weight).toBeCloseTo(1.5)
    expect(JSON.parse(rows[0]?.metadata.also_verified_by ?? "[]")).toEqual([b.userId])

    // The strengthened row re-syncs to a member whose cursor already passed it.
    const repull = await call(gw, "/v1/team-memory/pull", b.code, { since_seq: cursor })
    expect(pulled(repull)).toHaveLength(1)
    expect(pulled(repull)[0]?.weight).toBeCloseTo(1.5)

    // An idempotent replay of the original push changes nothing.
    const replay = await call(gw, "/v1/team-memory/push", a.code, { entries: [entry()] })
    expect(results(replay)).toEqual([{ id: "mem_1", result: "stored" }])
    const after = await call(gw, "/v1/team-memory/list", a.code, {})
    expect(pulled(after)).toHaveLength(1)
    expect(pulled(after)[0]?.weight).toBeCloseTo(1.5)
  })

  test("push validation: oversize, invalid outcome, missing signature, batch cap", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])

    const oversize = await call(gw, "/v1/team-memory/push", a.code, {
      entries: [entry({ content: "x".repeat(4097) })],
    })
    expect(results(oversize)).toEqual([{ id: "mem_1", result: "rejected", reason: "oversize" }])

    // Exactly 4 KB is at the cap, not over it.
    const atCap = await call(gw, "/v1/team-memory/push", a.code, {
      entries: [entry({ id: "mem_cap", content: "x".repeat(4096) })],
    })
    expect(results(atCap)).toEqual([{ id: "mem_cap", result: "stored" }])

    const opinion = await call(gw, "/v1/team-memory/push", a.code, {
      entries: [entry({ id: "mem_opinion", outcome: "opinion" })],
    })
    expect(results(opinion)).toEqual([
      { id: "mem_opinion", result: "rejected", reason: "invalid_outcome" },
    ])

    const noSignature = await call(gw, "/v1/team-memory/push", a.code, {
      entries: [entry({ id: "mem_nosig", metadata: {} })],
    })
    expect(results(noSignature)).toEqual([
      { id: "mem_nosig", result: "rejected", reason: "missing_signature" },
    ])

    const batch = await call(gw, "/v1/team-memory/push", a.code, {
      entries: Array.from({ length: 51 }, (_, i) => entry({ id: `mem_batch_${i}` })),
    })
    expect(batch.status).toBe(400)

    const notArray = await call(gw, "/v1/team-memory/push", a.code, { entries: "nope" })
    expect(notArray.status).toBe(400)
  })

  test("secret-shaped content is rejected and the author is notified", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])

    const secret = `sk-${"a1".repeat(20)}`
    const push = await call(gw, "/v1/team-memory/push", a.code, {
      entries: [entry({ content: `The deploy key is ${secret} — rotate it.` })],
    })
    expect(results(push)).toEqual([{ id: "mem_1", result: "rejected", reason: "secret_detected" }])

    const list = await call(gw, "/v1/team-memory/list", a.code, {})
    expect(pulled(list)).toEqual([])

    const notes = store.listNotifications(a.uid)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.type).toBe("memory_rejected")
    const payload = JSON.parse(notes[0]?.payload ?? "{}") as Record<string, unknown>
    expect(payload.entry_id).toBe("mem_1")
    expect(payload.container).toBe("repo-x")
    // The notification must not carry the secret itself.
    expect(notes[0]?.payload).not.toContain(secret)
  })
})

describe("team memory removal and membership", () => {
  test("author removes; pull then carries a tombstone without the content", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    makeTeam(store, a, [b])

    await call(gw, "/v1/team-memory/push", a.code, { entries: [entry()] })
    const seen = await call(gw, "/v1/team-memory/pull", b.code, { since_seq: 0 })
    const cursor = seen.json.next_seq as number

    const removed = await call(gw, "/v1/team-memory/remove", a.code, { id: "mem_1" })
    expect(removed.status).toBe(200)

    const delta = await call(gw, "/v1/team-memory/pull", b.code, { since_seq: cursor })
    expect(pulled(delta)).toEqual([])
    expect(delta.json.tombstones).toEqual(["mem_1"])

    // The row stays server-side as an archived tombstone (audit/browse),
    // but a fresh pull never returns its content again.
    const list = await call(gw, "/v1/team-memory/list", a.code, {})
    expect(pulled(list)).toHaveLength(1)
    expect(pulled(list)[0]?.status).toBe("archived")
    const fresh = await call(gw, "/v1/team-memory/pull", b.code, { since_seq: 0 })
    expect(pulled(fresh)).toEqual([])
    expect(fresh.json.tombstones).toEqual(["mem_1"])

    // A queued re-push of the removed capture does not resurrect it.
    const zombie = await call(gw, "/v1/team-memory/push", a.code, { entries: [entry()] })
    expect(results(zombie)).toEqual([{ id: "mem_1", result: "rejected", reason: "archived" }])
  })

  test("a plain member cannot remove another's entry; owners and admins can", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])

    await call(gw, "/v1/team-memory/push", a.code, { entries: [entry()] })
    await call(gw, "/v1/team-memory/push", b.code, {
      entries: [entry({ id: "mem_b", metadata: { signature: "src/b.ts|bun test" } })],
    })

    // b (plain member) cannot remove a's entry.
    const byMember = await call(gw, "/v1/team-memory/remove", b.code, { id: "mem_1" })
    expect(byMember.status).toBe(403)

    // The owner can remove a member's entry.
    const byOwner = await call(gw, "/v1/team-memory/remove", a.code, { id: "mem_b" })
    expect(byOwner.status).toBe(200)

    // Promoted to admin, b can remove a's entry.
    expect(
      store.setTeamMemberRole({ teamId, actorUid: a.uid, targetUid: b.uid, role: "admin" }),
    ).toEqual({ ok: true })
    const byAdmin = await call(gw, "/v1/team-memory/remove", b.code, { id: "mem_1" })
    expect(byAdmin.status).toBe(200)
  })

  test("a removed member's next push is denied and pull returns revoked", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])

    await call(gw, "/v1/team-memory/push", b.code, { entries: [entry()] })
    expect(
      store.removeTeamMember({ teamId, actorUid: a.uid, targetUid: b.uid }),
    ).toEqual({ ok: true })

    const push = await call(gw, "/v1/team-memory/push", b.code, {
      entries: [entry({ id: "mem_late", metadata: { signature: "src/late.ts|bun test" } })],
    })
    expect(push.status).toBe(409)

    const pull = await call(gw, "/v1/team-memory/pull", b.code, { since_seq: 0 })
    expect(pull.status).toBe(200)
    expect(pull.json.revoked).toBe(true)
    expect(pulled(pull)).toEqual([])

    // The leaver's earlier entries stay with the team (decision D3).
    const remaining = await call(gw, "/v1/team-memory/list", a.code, {})
    expect(pulled(remaining)).toHaveLength(1)
    expect(pulled(remaining)[0]?.author_user_id).toBe(b.userId)
  })

  test("accounts with no team: push/list/remove denied, pull returns revoked", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const solo = makeAccount(store, "uid_solo")

    const push = await call(gw, "/v1/team-memory/push", solo.code, { entries: [entry()] })
    expect(push.status).toBe(409)
    const list = await call(gw, "/v1/team-memory/list", solo.code, {})
    expect(list.status).toBe(409)
    const remove = await call(gw, "/v1/team-memory/remove", solo.code, { id: "mem_1" })
    expect(remove.status).toBe(409)

    const pull = await call(gw, "/v1/team-memory/pull", solo.code, { since_seq: 0 })
    expect(pull.status).toBe(200)
    expect(pull.json).toEqual({ revoked: true, entries: [], tombstones: [], next_seq: 0 })
  })

  test("bare invites and missing auth are refused; connector keys are read-only", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])
    const bare = store.createInvite()

    const barePush = await call(gw, "/v1/team-memory/push", bare.code, { entries: [entry()] })
    expect(barePush.status).toBe(403)

    const anon = await call(gw, "/v1/team-memory/pull", undefined, { since_seq: 0 })
    expect(anon.status).toBe(401)

    const connector = store.createApiKey({ inviteCode: a.code, kind: "connector" })
    if (!connector) throw new Error("connector mint failed")
    const headers = { "X-Grist-Api-Key": connector.secret }
    const connPush = await call(gw, "/v1/team-memory/push", undefined, { entries: [entry()] }, headers)
    expect(connPush.status).toBe(403)
    const connRemove = await call(gw, "/v1/team-memory/remove", undefined, { id: "mem_1" }, headers)
    expect(connRemove.status).toBe(403)
    const connPull = await call(gw, "/v1/team-memory/pull", undefined, { since_seq: 0 }, headers)
    expect(connPull.status).toBe(200)
  })

  test("pushes are rate-limited per actor", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])
    let last = 0
    for (let attempt = 0; attempt < 121; attempt++) {
      const res = await call(gw, "/v1/team-memory/push", a.code, { entries: [] })
      last = res.status
    }
    expect(last).toBe(429)
  })

  test("store, strengthen and remove all land in the audit trail — without bodies", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])

    await call(gw, "/v1/team-memory/push", a.code, { entries: [entry()] })
    await call(gw, "/v1/team-memory/push", b.code, { entries: [entry({ id: "mem_again" })] })
    await call(gw, "/v1/team-memory/remove", a.code, { id: "mem_1" })

    const audit = store.teamMemoryAudit(teamId)
    expect(audit.map((row) => row.action)).toEqual(["store", "strengthen", "remove"])
    expect(audit.map((row) => row.actor_uid)).toEqual([a.uid, b.uid, a.uid])
    expect(audit.every((row) => row.entry_id === "mem_1")).toBe(true)
    expect(JSON.stringify(audit)).not.toContain("package dir")
  })
})

describe("secrets scan", () => {
  test("flags credential shapes", () => {
    expect(findSecretKind("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe("private_key")
    expect(findSecretKind("-----BEGIN PRIVATE KEY-----")).toBe("private_key")
    expect(findSecretKind(`key: sk-${"x".repeat(30)}`)).toBe("sk_key")
    expect(findSecretKind(`ghp_${"A".repeat(36)}`)).toBe("github_token")
    expect(findSecretKind("the id was AKIAIOSFODNN7EXAMPLE")).toBe("aws_key")
    expect(findSecretKind(`grist_sk_${"0123456789abcdef".repeat(4)}`)).toBe("grist_key")
    expect(findSecretKind(`Authorization: Bearer ${"t".repeat(32)}`)).toBe("bearer_token")
    expect(
      findSecretKind("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc-def_123456"),
    ).toBe("jwt")
  })

  test("leaves ordinary code discussion alone", () => {
    expect(
      findSecretKind(
        "The token bucket refills at 10/min; the bearer of a stale session cookie gets a 401 and the client retries with backoff.",
      ),
    ).toBeUndefined()
    expect(
      findSecretKind("Set password = 'hunter2' in the fixture only; production reads it from the vault."),
    ).toBeUndefined()
    expect(findSecretKind("GitHub PATs start with ghp_ but this note stores none.")).toBeUndefined()
    expect(findSecretKind("-----BEGIN CERTIFICATE----- is fine to log.")).toBeUndefined()
    expect(findSecretKind("The task-list renderer keys rows by skuid, not by index.")).toBeUndefined()
  })
})
