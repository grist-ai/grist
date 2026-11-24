import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createGateway } from "./http.js"
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

function skill(overrides?: Record<string, unknown>): Record<string, unknown> {
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

function agentDef(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "def_1",
    kind: "agent_definition",
    container: "repo-x",
    name: "reviewer",
    body: "You review diffs for correctness and call out risky changes.",
    metadata: { tools: ["read", "grep"], rung_ceiling: "medium" },
    ...overrides,
  }
}

type ResultRow = { id: string | null; result: string; reason?: string }
type PulledObject = {
  id: string
  kind: string
  name: string
  body: string
  author_user_id: string
  status: string
  seq: number
  supersedes: string | null
  is_head: boolean
  metadata: Record<string, unknown>
}

function results(res: CallResult): ResultRow[] {
  return res.json.results as ResultRow[]
}

function pulled(res: CallResult): PulledObject[] {
  return res.json.objects as PulledObject[]
}

describe("team object sync", () => {
  test("push → pull round-trip across two members, with attribution and cursor", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    makeTeam(store, a, [b])

    const push = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill(), agentDef()],
    })
    expect(push.status).toBe(200)
    expect(results(push)).toEqual([
      { id: "obj_1", result: "stored" },
      { id: "def_1", result: "stored" },
    ])

    const first = await call(gw, "/v1/team-objects/pull", b.code, { since_seq: 0 })
    expect(first.status).toBe(200)
    const objects = pulled(first)
    expect(objects).toHaveLength(2)
    expect(objects[0]?.author_user_id).toBe(a.userId)
    expect(objects[0]?.is_head).toBe(true)
    expect(objects[0]?.metadata).toEqual({ description: "Pre-deploy verification checklist" })
    expect(objects[1]?.metadata).toEqual({ tools: ["read", "grep"], rung_ceiling: "medium" })
    expect(first.json.next_seq).toBe(2)
    expect(first.json.tombstones).toEqual([])

    // The cursor makes the next pull empty; the objects seq space is its
    // own — memory traffic never moves it (and vice versa).
    const second = await call(gw, "/v1/team-objects/pull", b.code, { since_seq: 2 })
    expect(pulled(second)).toEqual([])
    expect(second.json.next_seq).toBe(2)

    // Kind and container filters scope the pull.
    const skillsOnly = await call(gw, "/v1/team-objects/pull", b.code, {
      since_seq: 0,
      kinds: ["skill"],
    })
    expect(pulled(skillsOnly).map((o) => o.id)).toEqual(["obj_1"])
    const elsewhere = await call(gw, "/v1/team-objects/pull", b.code, {
      since_seq: 0,
      containers: ["repo-y"],
    })
    expect(pulled(elsewhere)).toEqual([])
  })

  test("edit chain A→B→C pulls as C-only; A and B are retained as history", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])

    await call(gw, "/v1/team-objects/push", a.code, { objects: [skill()] })
    const editB = await call(gw, "/v1/team-objects/push", b.code, {
      objects: [skill({ id: "obj_2", body: "v2: also check the queue depth.", supersedes: "obj_1" })],
    })
    expect(results(editB)).toEqual([{ id: "obj_2", result: "stored" }])
    const editC = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_3", body: "v3: and page on-call.", supersedes: "obj_2" })],
    })
    expect(results(editC)).toEqual([{ id: "obj_3", result: "stored" }])

    // Pull converges mirrors on the head only.
    const pull = await call(gw, "/v1/team-objects/pull", b.code, { since_seq: 0 })
    const heads = pulled(pull)
    expect(heads).toHaveLength(1)
    expect(heads[0]?.id).toBe("obj_3")
    expect(heads[0]?.body).toContain("page on-call")
    expect(heads[0]?.supersedes).toBe("obj_2")
    expect(pull.json.next_seq).toBe(3)

    // History is fully retained and reachable through list: all three
    // versions, only the tip flagged as head, none archived — archiving
    // superseded rows is the policy sweep's job, not the edit's.
    const list = await call(gw, "/v1/team-objects/list", a.code, {
      container: "repo-x",
      kind: "skill",
      name: "deploy-check",
    })
    const chain = pulled(list)
    expect(chain.map((o) => o.id).sort()).toEqual(["obj_1", "obj_2", "obj_3"])
    expect(chain.every((o) => o.status === "active")).toBe(true)
    expect(chain.filter((o) => o.is_head).map((o) => o.id)).toEqual(["obj_3"])

    // The chain's life is on the audit trail, tagged with the object kind.
    const audit = store.teamMemoryAudit(teamId).filter((row) => row.kind === "skill")
    expect(audit.map((row) => row.action)).toEqual(["store", "edit", "edit"])
    expect(audit.map((row) => row.entry_id)).toEqual(["obj_1", "obj_2", "obj_3"])
  })

  test("cross-team isolation: no reads, edits, supersedes, or removes across teams", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const c = makeAccount(store, "uid_c")
    const d = makeAccount(store, "uid_d")
    makeTeam(store, a, [b], "One")
    makeTeam(store, c, [d], "Two")

    await call(gw, "/v1/team-objects/push", a.code, { objects: [skill()] })

    // Team Two sees nothing of Team One.
    const foreign = await call(gw, "/v1/team-objects/pull", d.code, { since_seq: 0 })
    expect(pulled(foreign)).toEqual([])
    expect(foreign.json.next_seq).toBe(0)
    const foreignList = await call(gw, "/v1/team-objects/list", d.code, {})
    expect(pulled(foreignList)).toEqual([])

    // A remove aimed at Team One's object id is a 404 in Team Two.
    const foreignRemove = await call(gw, "/v1/team-objects/remove", d.code, { id: "obj_1" })
    expect(foreignRemove.status).toBe(404)

    // An edit in Team Two pointing its supersedes at Team One's object id
    // is refused without learning anything about the foreign row.
    const foreignEdit = await call(gw, "/v1/team-objects/push", d.code, {
      objects: [skill({ id: "obj_t2", supersedes: "obj_1" })],
    })
    expect(results(foreignEdit)).toEqual([
      { id: "obj_t2", result: "rejected", reason: "supersedes_not_found" },
    ])

    // The same id and the same (container, kind, name) in Team Two are an
    // independent chain — ids and names are scoped per team.
    const own = await call(gw, "/v1/team-objects/push", d.code, { objects: [skill()] })
    expect(results(own)).toEqual([{ id: "obj_1", result: "stored" }])
    const oneList = await call(gw, "/v1/team-objects/list", a.code, {})
    expect(pulled(oneList)).toHaveLength(1)
    expect(pulled(oneList)[0]?.author_user_id).toBe(a.userId)
  })

  test("chain discipline: forks, stale heads, and id conflicts are refused", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])

    await call(gw, "/v1/team-objects/push", a.code, { objects: [skill()] })
    await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_2", body: "v2 body.", supersedes: "obj_1" })],
    })

    // A second root for a name that already has a live chain.
    const fork = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_fork" })],
    })
    expect(results(fork)).toEqual([{ id: "obj_fork", result: "rejected", reason: "name_taken" }])

    // An edit off a superseded (non-tip) row is a fork, not a version.
    const stale = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_stale", body: "branch off v1.", supersedes: "obj_1" })],
    })
    expect(results(stale)).toEqual([
      { id: "obj_stale", result: "rejected", reason: "stale_head" },
    ])

    // An edit pointing at another chain's head is equally stale here.
    await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_other", name: "other-skill" })],
    })
    const cross = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_cross", body: "wrong chain.", supersedes: "obj_other" })],
    })
    expect(results(cross)).toEqual([
      { id: "obj_cross", result: "rejected", reason: "stale_head" },
    ])

    // Ids are immutable version identities: same id, new content, refused.
    const conflict = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ body: "rewritten under the same id." })],
    })
    expect(results(conflict)).toEqual([
      { id: "obj_1", result: "rejected", reason: "id_conflict" },
    ])

    // An identical replay of an earlier push is a no-op, not an error:
    // the chain and the cursor do not move.
    const before = await call(gw, "/v1/team-objects/pull", a.code, { since_seq: 0 })
    const replay = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_2", body: "v2 body.", supersedes: "obj_1" })],
    })
    expect(results(replay)).toEqual([{ id: "obj_2", result: "stored" }])
    const after = await call(gw, "/v1/team-objects/pull", a.code, { since_seq: 0 })
    expect(after.json.next_seq).toBe(before.json.next_seq)
    const list = await call(gw, "/v1/team-objects/list", a.code, { name: "deploy-check" })
    expect(pulled(list)).toHaveLength(2)
  })

  test("admission: per-kind schema validity, name legality, size caps", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])

    // A skill with no description anywhere is not a definition yet.
    const noDesc = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ metadata: {} })],
    })
    expect(results(noDesc)).toEqual([
      { id: "obj_1", result: "rejected", reason: "invalid_schema" },
    ])

    // The description may live in the body's own SKILL.md frontmatter.
    const frontmatter = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [
        skill({
          id: "obj_fm",
          name: "frontmattered",
          metadata: {},
          body: [
            "---",
            "name: frontmattered",
            'description: "Check the deploy from the frontmatter"',
            "---",
            "Run the smoke suite.",
          ].join("\n"),
        }),
      ],
    })
    expect(results(frontmatter)).toEqual([{ id: "obj_fm", result: "stored" }])

    // Frontmatter that names a different skill is a contradiction.
    const mismatch = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [
        skill({
          id: "obj_mm",
          name: "claimed-name",
          body: ["---", "name: other-name", "description: d", "---", "Body."].join("\n"),
        }),
      ],
    })
    expect(results(mismatch)).toEqual([
      { id: "obj_mm", result: "rejected", reason: "invalid_schema" },
    ])

    // An unclosed frontmatter block is unparseable.
    const unclosed = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [
        skill({
          id: "obj_uc",
          name: "unclosed",
          body: "---\nname: unclosed\ndescription: d\nBody with no closing fence.",
        }),
      ],
    })
    expect(results(unclosed)).toEqual([
      { id: "obj_uc", result: "rejected", reason: "invalid_schema" },
    ])

    // Agent definitions: the spec'd config fields are type-checked when
    // present; unknown rungs and non-array tool surfaces are rejected.
    const badRung = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [agentDef({ metadata: { rung_ceiling: "ultra" } })],
    })
    expect(results(badRung)).toEqual([
      { id: "def_1", result: "rejected", reason: "invalid_schema" },
    ])
    const badTools = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [agentDef({ metadata: { tools: "read" } })],
    })
    expect(results(badTools)).toEqual([
      { id: "def_1", result: "rejected", reason: "invalid_schema" },
    ])
    const minimalDef = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [agentDef({ metadata: {} })],
    })
    expect(results(minimalDef)).toEqual([{ id: "def_1", result: "stored" }])

    // Kinds outside the filesystem allowlist — memory (which never
    // lands here) and anything unnamed — are refused at the boundary.
    // (Artifact joined the allowlist in S-FS3; its admission is covered
    // by the artifact describe below.)
    for (const kind of ["memory", "note"]) {
      const res = await call(gw, "/v1/team-objects/push", a.code, {
        objects: [skill({ id: `obj_kind_${kind}`, kind })],
      })
      expect(results(res)).toEqual([
        { id: `obj_kind_${kind}`, result: "rejected", reason: "invalid_kind" },
      ])
    }

    // Names are slugs: no spaces, no path tricks.
    for (const name of ["Deploy Check", "../evil", "-leading-dash", ""]) {
      const res = await call(gw, "/v1/team-objects/push", a.code, {
        objects: [skill({ id: "obj_name", name })],
      })
      expect(results(res)).toEqual([
        { id: "obj_name", result: "rejected", reason: "invalid_name" },
      ])
    }

    // The 32 KB body cap: at it stores, over it is rejected.
    const atCap = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_cap", name: "at-cap", body: "x".repeat(32 * 1024) })],
    })
    expect(results(atCap)).toEqual([{ id: "obj_cap", result: "stored" }])
    const overCap = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_over", name: "over-cap", body: "x".repeat(32 * 1024 + 1) })],
    })
    expect(results(overCap)).toEqual([
      { id: "obj_over", result: "rejected", reason: "oversize" },
    ])

    // Metadata must be a JSON object — objects carry a real metadata
    // contract, not memory's string map, but not an array either.
    const arrayMeta = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_meta", name: "meta-case", metadata: ["description"] })],
    })
    expect(results(arrayMeta)).toEqual([
      { id: "obj_meta", result: "rejected", reason: "invalid_metadata" },
    ])

    // Batch discipline mirrors memory's.
    const batch = await call(gw, "/v1/team-objects/push", a.code, {
      objects: Array.from({ length: 51 }, (_, i) => skill({ id: `obj_batch_${i}` })),
    })
    expect(batch.status).toBe(400)
    const notArray = await call(gw, "/v1/team-objects/push", a.code, { objects: "nope" })
    expect(notArray.status).toBe(400)
  })

  test("secret-shaped bodies and metadata are rejected and the author is notified", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])

    const secret = `sk-${"a1".repeat(20)}`
    const inBody = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ body: `Use this key to verify: ${secret}` })],
    })
    expect(results(inBody)).toEqual([
      { id: "obj_1", result: "rejected", reason: "secret_detected" },
    ])

    const inMeta = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [
        agentDef({
          id: "def_secret",
          metadata: { tools: ["read"], note: `token ghp_${"A".repeat(36)}` },
        }),
      ],
    })
    expect(results(inMeta)).toEqual([
      { id: "def_secret", result: "rejected", reason: "secret_detected" },
    ])

    const list = await call(gw, "/v1/team-objects/list", a.code, {})
    expect(pulled(list)).toEqual([])

    const notes = store.listNotifications(a.uid)
    expect(notes).toHaveLength(2)
    expect(notes.every((note) => note.type === "object_rejected")).toBe(true)
    expect(JSON.stringify(notes)).not.toContain(secret)
    expect(JSON.stringify(notes)).not.toContain("ghp_")
  })
})

describe("team object removal and membership", () => {
  test("author removes the head; pull carries a tombstone; the chain stays closed", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    makeTeam(store, a, [b])

    await call(gw, "/v1/team-objects/push", a.code, { objects: [skill()] })
    const seen = await call(gw, "/v1/team-objects/pull", b.code, { since_seq: 0 })
    const cursor = seen.json.next_seq as number

    const removed = await call(gw, "/v1/team-objects/remove", a.code, { id: "obj_1" })
    expect(removed.status).toBe(200)

    const delta = await call(gw, "/v1/team-objects/pull", b.code, { since_seq: cursor })
    expect(pulled(delta)).toEqual([])
    expect(delta.json.tombstones).toEqual(["obj_1"])

    // The row stays server-side as an archived tombstone.
    const list = await call(gw, "/v1/team-objects/list", a.code, {})
    expect(pulled(list)).toHaveLength(1)
    expect(pulled(list)[0]?.status).toBe("archived")

    // Neither an edit off the removed head nor a fresh root under the
    // same name resurrects the chain — removals are deliberate.
    const zombieEdit = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_2", body: "back from the dead.", supersedes: "obj_1" })],
    })
    expect(results(zombieEdit)).toEqual([
      { id: "obj_2", result: "rejected", reason: "archived" },
    ])
    const zombieRoot = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_3" })],
    })
    expect(results(zombieRoot)).toEqual([
      { id: "obj_3", result: "rejected", reason: "archived" },
    ])
  })

  test("a plain member cannot remove another's object; owners and admins can", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])

    await call(gw, "/v1/team-objects/push", a.code, { objects: [skill()] })
    await call(gw, "/v1/team-objects/push", b.code, {
      objects: [skill({ id: "obj_b", name: "b-skill" })],
    })

    const byMember = await call(gw, "/v1/team-objects/remove", b.code, { id: "obj_1" })
    expect(byMember.status).toBe(403)

    const byOwner = await call(gw, "/v1/team-objects/remove", a.code, { id: "obj_b" })
    expect(byOwner.status).toBe(200)

    expect(
      store.setTeamMemberRole({ teamId, actorUid: a.uid, targetUid: b.uid, role: "admin" }),
    ).toEqual({ ok: true })
    const byAdmin = await call(gw, "/v1/team-objects/remove", b.code, { id: "obj_1" })
    expect(byAdmin.status).toBe(200)
  })

  test("removing a history row leaves the head live", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])

    await call(gw, "/v1/team-objects/push", a.code, { objects: [skill()] })
    await call(gw, "/v1/team-objects/push", a.code, {
      objects: [skill({ id: "obj_2", body: "v2 body.", supersedes: "obj_1" })],
    })
    const removed = await call(gw, "/v1/team-objects/remove", a.code, { id: "obj_1" })
    expect(removed.status).toBe(200)

    const pull = await call(gw, "/v1/team-objects/pull", a.code, { since_seq: 0 })
    expect(pulled(pull).map((o) => o.id)).toEqual(["obj_2"])
    expect(pull.json.tombstones).toEqual(["obj_1"])
  })

  test("accounts with no team: push/list/remove denied, pull returns revoked", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const solo = makeAccount(store, "uid_solo")

    const push = await call(gw, "/v1/team-objects/push", solo.code, { objects: [skill()] })
    expect(push.status).toBe(409)
    const list = await call(gw, "/v1/team-objects/list", solo.code, {})
    expect(list.status).toBe(409)
    const remove = await call(gw, "/v1/team-objects/remove", solo.code, { id: "obj_1" })
    expect(remove.status).toBe(409)

    const pull = await call(gw, "/v1/team-objects/pull", solo.code, { since_seq: 0 })
    expect(pull.status).toBe(200)
    expect(pull.json).toEqual({ revoked: true, objects: [], tombstones: [], next_seq: 0 })
  })

  test("a removed member's next push is denied and pull returns revoked", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    const teamId = makeTeam(store, a, [b])

    await call(gw, "/v1/team-objects/push", b.code, { objects: [skill()] })
    expect(store.removeTeamMember({ teamId, actorUid: a.uid, targetUid: b.uid })).toEqual({
      ok: true,
    })

    const push = await call(gw, "/v1/team-objects/push", b.code, {
      objects: [skill({ id: "obj_late", name: "late-skill" })],
    })
    expect(push.status).toBe(409)
    const pull = await call(gw, "/v1/team-objects/pull", b.code, { since_seq: 0 })
    expect(pull.json.revoked).toBe(true)

    // The leaver's objects stay with the team, as their memory does (D3).
    const remaining = await call(gw, "/v1/team-objects/list", a.code, {})
    expect(pulled(remaining)).toHaveLength(1)
    expect(pulled(remaining)[0]?.author_user_id).toBe(b.userId)
  })

  test("bare invites and missing auth are refused; connector keys are read-only", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])
    const bare = store.createInvite()

    const barePush = await call(gw, "/v1/team-objects/push", bare.code, { objects: [skill()] })
    expect(barePush.status).toBe(403)

    const anon = await call(gw, "/v1/team-objects/pull", undefined, { since_seq: 0 })
    expect(anon.status).toBe(401)

    const connector = store.createApiKey({ inviteCode: a.code, kind: "connector" })
    if (!connector) throw new Error("connector mint failed")
    const headers = { "X-Grist-Api-Key": connector.secret }
    const connPush = await call(
      gw,
      "/v1/team-objects/push",
      undefined,
      { objects: [skill()] },
      headers,
    )
    expect(connPush.status).toBe(403)
    const connRemove = await call(
      gw,
      "/v1/team-objects/remove",
      undefined,
      { id: "obj_1" },
      headers,
    )
    expect(connRemove.status).toBe(403)
    const connPull = await call(gw, "/v1/team-objects/pull", undefined, { since_seq: 0 }, headers)
    expect(connPull.status).toBe(200)
  })

  test("pushes are rate-limited per actor", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])
    let last = 0
    for (let attempt = 0; attempt < 121; attempt++) {
      const res = await call(gw, "/v1/team-objects/push", a.code, { objects: [] })
      last = res.status
    }
    expect(last).toBe(429)
  })
})

describe("one audit trail for the whole filesystem", () => {
  test("memory and object actions interleave on one trail, tagged by kind, without bodies", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const teamId = makeTeam(store, a, [])

    await call(gw, "/v1/team-memory/push", a.code, {
      entries: [
        {
          id: "mem_1",
          content: "Run bun test from the package dir.",
          container: "repo-x",
          outcome: "tests_passed",
          metadata: { signature: "src/a.ts|bun test" },
        },
      ],
    })
    await call(gw, "/v1/team-objects/push", a.code, { objects: [skill(), agentDef()] })
    await call(gw, "/v1/team-objects/remove", a.code, { id: "def_1" })

    const audit = store.teamMemoryAudit(teamId)
    expect(audit.map((row) => [row.kind, row.action])).toEqual([
      ["memory", "store"],
      ["skill", "store"],
      ["agent_definition", "store"],
      ["agent_definition", "remove"],
    ])
    expect(JSON.stringify(audit)).not.toContain("smoke suite")
    expect(JSON.stringify(audit)).not.toContain("review diffs")
  })

  test("a pre-filesystem database gains the kind column with memory as the exact backfill", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grist-fs-migration-"))
    const file = path.join(dir, "gateway.db")
    try {
      // A database written before the filesystem existed: the audit
      // table in its original shape, one memory row already in it.
      const raw = new Database(file)
      raw.exec(`CREATE TABLE team_memory_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id TEXT NOT NULL,
        actor_uid TEXT NOT NULL,
        action TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        at INTEGER NOT NULL
      )`)
      raw.run(
        "INSERT INTO team_memory_audit (team_id, actor_uid, action, entry_id, at) VALUES (?, ?, ?, ?, ?)",
        ["gt_legacy", "uid_old", "store", "mem_old", 1_700_000_000_000],
      )
      raw.close()

      const store = openGatewayStore(file)
      const legacy = store.teamMemoryAudit("gt_legacy")
      expect(legacy).toHaveLength(1)
      expect(legacy[0]?.kind).toBe("memory")

      // New object actions land on the same trail with their own kind.
      const pushed = store.pushTeamObject(
        "gt_legacy",
        { uid: "uid_new", userId: null },
        {
          id: "obj_new",
          kind: "skill",
          container: "repo-x",
          name: "deploy-check",
          body: "Verify the deploy.",
          metadata: { description: "Pre-deploy verification checklist" },
          supersedes: null,
        },
      )
      expect(pushed.status).toBe("stored")
      const trail = store.teamMemoryAudit("gt_legacy")
      expect(trail.map((row) => row.kind)).toEqual(["memory", "skill"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("artifact admission (filesystem spec v1 §5, S-FS3)", () => {
  function artifact(overrides?: Record<string, unknown>): Record<string, unknown> {
    return {
      id: "art_1",
      kind: "artifact",
      container: "repo-x",
      name: "fix-diff",
      body: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old line\n+new line\n",
      metadata: { session_id: "sess_1" },
      ...overrides,
    }
  }

  function memoryEntry(overrides?: Record<string, unknown>): Record<string, unknown> {
    return {
      id: "mem_1",
      content: "Run bun test from the package dir.",
      container: "repo-x",
      outcome: "tests_passed",
      weight: 0.75,
      createdAt: 1_700_000_000_000,
      sessionID: "sess_1",
      metadata: { signature: "src/a.ts|bun test" },
      ...overrides,
    }
  }

  async function pushMemory(gw: Gateway, code: string, entries: Record<string, unknown>[]) {
    const res = await call(gw, "/v1/team-memory/push", code, { entries })
    expect(res.status).toBe(200)
    return res
  }

  test("a valid artifact is stored and pulls, with its provenance intact", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const b = makeAccount(store, "uid_b")
    makeTeam(store, a, [b])
    // The session exists for the team because a memory entry carries it.
    await pushMemory(gw, a.code, [memoryEntry()])

    const push = await call(gw, "/v1/team-objects/push", a.code, { objects: [artifact()] })
    expect(results(push)).toEqual([{ id: "art_1", result: "stored" }])

    const pulledAll = await call(gw, "/v1/team-objects/pull", b.code, { since_seq: 0 })
    expect(pulled(pulledAll).map((object) => object.id)).toEqual(["art_1"])
    expect(pulled(pulledAll)[0]?.kind).toBe("artifact")
    expect(pulled(pulledAll)[0]?.metadata).toEqual({ session_id: "sess_1" })

    const pulledKind = await call(gw, "/v1/team-objects/pull", b.code, {
      since_seq: 0,
      kinds: ["artifact"],
    })
    expect(pulled(pulledKind)).toHaveLength(1)
    const pulledSkills = await call(gw, "/v1/team-objects/pull", b.code, {
      since_seq: 0,
      kinds: ["skill"],
    })
    expect(pulled(pulledSkills)).toHaveLength(0)

    // The audit row carries the artifact kind on the shared trail.
    const teamId = store.getTeamForUser(a.uid)?.team.id as string
    const audit = store.teamMemoryAudit(teamId).filter((row) => row.entry_id === "art_1")
    expect(audit).toHaveLength(1)
    expect(audit[0]?.kind).toBe("artifact")
    expect(audit[0]?.action).toBe("store")
  })

  test("provenance must name a memory entry or session that exists for the team", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])
    await pushMemory(gw, a.code, [memoryEntry()])

    // By memory entry id: resolves.
    const byEntry = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [artifact({ id: "art_entry", metadata: { memory_entry_id: "mem_1" } })],
    })
    expect(results(byEntry)).toEqual([{ id: "art_entry", result: "stored" }])

    // Both named, both resolve: stored.
    const both = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [
        artifact({
          id: "art_both",
          name: "both-links",
          metadata: { memory_entry_id: "mem_1", session_id: "sess_1" },
        }),
      ],
    })
    expect(results(both)).toEqual([{ id: "art_both", result: "stored" }])

    // Named but not found — entry, session, and one-of-two alike.
    for (const [id, metadata] of [
      ["art_ghost_entry", { memory_entry_id: "mem_nope" }],
      ["art_ghost_session", { session_id: "sess_nope" }],
      ["art_half", { memory_entry_id: "mem_1", session_id: "sess_nope" }],
    ] as const) {
      const res = await call(gw, "/v1/team-objects/push", a.code, {
        objects: [artifact({ id, name: `n-${id}`, metadata })],
      })
      expect(results(res)).toEqual([{ id, result: "rejected", reason: "provenance_not_found" }])
    }

    // Nothing named, or named in the wrong shape: missing provenance.
    for (const [id, metadata] of [
      ["art_none", {}],
      ["art_empty", { session_id: "" }],
      ["art_typed", { memory_entry_id: 42 }],
    ] as const) {
      const res = await call(gw, "/v1/team-objects/push", a.code, {
        objects: [artifact({ id, name: `n-${id}`, metadata })],
      })
      expect(results(res)).toEqual([{ id, result: "rejected", reason: "missing_provenance" }])
    }
  })

  test("provenance does not resolve across teams", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    const c = makeAccount(store, "uid_c")
    makeTeam(store, a, [])
    makeTeam(store, c, [], "Other")
    await pushMemory(gw, a.code, [memoryEntry()])

    // Team C names team A's memory entry and session: neither exists
    // for team C, and nothing about team A leaks in the answer.
    const byEntry = await call(gw, "/v1/team-objects/push", c.code, {
      objects: [artifact({ metadata: { memory_entry_id: "mem_1" } })],
    })
    expect(results(byEntry)).toEqual([
      { id: "art_1", result: "rejected", reason: "provenance_not_found" },
    ])
    const bySession = await call(gw, "/v1/team-objects/push", c.code, {
      objects: [artifact({ id: "art_2", name: "other-diff" })],
    })
    expect(results(bySession)).toEqual([
      { id: "art_2", result: "rejected", reason: "provenance_not_found" },
    ])
  })

  test("artifacts get their own 64 KB cap — past the document cap stores, past 64 KB is oversize", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])
    await pushMemory(gw, a.code, [memoryEntry()])

    // 40 KB: over the 32 KB skill/def cap, under the artifact cap.
    const mid = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [artifact({ id: "art_mid", name: "mid-log", body: "x".repeat(40 * 1024) })],
    })
    expect(results(mid)).toEqual([{ id: "art_mid", result: "stored" }])

    const atCap = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [artifact({ id: "art_cap", name: "at-cap", body: "x".repeat(64 * 1024) })],
    })
    expect(results(atCap)).toEqual([{ id: "art_cap", result: "stored" }])

    const overCap = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [artifact({ id: "art_over", name: "over-cap", body: "x".repeat(64 * 1024 + 1) })],
    })
    expect(results(overCap)).toEqual([
      { id: "art_over", result: "rejected", reason: "oversize" },
    ])
  })

  test("binary-shaped bodies are rejected as not_text; secrets are still caught", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const a = makeAccount(store, "uid_a")
    makeTeam(store, a, [])
    await pushMemory(gw, a.code, [memoryEntry()])

    for (const [id, body] of [
      ["art_nul", "PK\u0003\u0004 binary zip bytes"],
      ["art_ctrl", "log line\u0007bell"],
      ["art_repl", "forced decode: \uFFFD\uFFFD"],
    ] as const) {
      const res = await call(gw, "/v1/team-objects/push", a.code, {
        objects: [artifact({ id, name: `n-${id}`, body })],
      })
      expect(results(res)).toEqual([{ id, result: "rejected", reason: "not_text" }])
    }

    // Ordinary log text — tabs, newlines, form feeds — is plain text.
    const log = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [artifact({ id: "art_log", name: "test-log", body: "ok\t1 passed\n\f2 passed\r\n" })],
    })
    expect(results(log)).toEqual([{ id: "art_log", result: "stored" }])

    const secret = `sk-${"a1".repeat(20)}`
    const leaked = await call(gw, "/v1/team-objects/push", a.code, {
      objects: [artifact({ id: "art_secret", name: "leaked", body: `the key was ${secret}` })],
    })
    expect(results(leaked)).toEqual([
      { id: "art_secret", result: "rejected", reason: "secret_detected" },
    ])
  })
})
