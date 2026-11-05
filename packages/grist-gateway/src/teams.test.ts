import { afterAll, describe, expect, test } from "bun:test"
import { createGateway } from "./http.js"
import { parseMasterKey } from "./provider-keys.js"
import { openGatewayStore } from "./store.js"

type Store = ReturnType<typeof openGatewayStore>

function makeUser(store: Store, uid: string): { uid: string; userId: string } {
  const invite = store.createInvite()
  const bound = store.bindAccount({ uid, email: `${uid}@example.com`, inviteCode: invite.code })
  if (!bound.ok) throw new Error(`bind failed for ${uid}`)
  const userId = bound.account.user_id
  if (!userId) throw new Error(`no user_id assigned for ${uid}`)
  return { uid, userId }
}

function payloads(store: Store, uid: string): { type: string; payload: Record<string, unknown> }[] {
  return store.listNotifications(uid).map((row) => ({
    type: row.type,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }))
}

describe("public user IDs", () => {
  test("every bound account gets a unique, resolvable user ID", () => {
    const store = openGatewayStore()
    const a = makeUser(store, "uid_a")
    const b = makeUser(store, "uid_b")
    expect(a.userId).toMatch(/^gu_[0-9a-hjkmnp-tv-z]{10}$/)
    expect(a.userId).not.toBe(b.userId)
    expect(store.getAccountByUserId(a.userId)?.firebase_uid).toBe("uid_a")
    // Lookup tolerates case and surrounding whitespace.
    expect(store.getAccountByUserId(` ${a.userId.toUpperCase()} `)?.firebase_uid).toBe("uid_a")
    expect(store.getAccountByUserId("gu_0000000000")).toBeUndefined()
    expect(store.getAccountByUserId("not-an-id")).toBeUndefined()
  })
})

describe("teams", () => {
  test("anyone can create a team and becomes its owner", () => {
    const store = openGatewayStore()
    const a = makeUser(store, "uid_a")
    const created = store.createTeam({ ownerUid: a.uid, name: "  Core Team  " })
    if (!created.ok) throw new Error("create failed")
    expect(created.team.name).toBe("Core Team")
    expect(created.team.owner_uid).toBe(a.uid)
    const mine = store.getTeamForUser(a.uid)
    expect(mine?.team.id).toBe(created.team.id)
    expect(mine?.membership.role).toBe("owner")
    expect(store.listTeamMembers(created.team.id)).toHaveLength(1)
  })

  test("a user already in a team cannot create or join another", () => {
    const store = openGatewayStore()
    const a = makeUser(store, "uid_a")
    const b = makeUser(store, "uid_b")
    const first = store.createTeam({ ownerUid: a.uid, name: "One" })
    const second = store.createTeam({ ownerUid: b.uid, name: "Two" })
    if (!first.ok || !second.ok) throw new Error("setup failed")
    expect(store.createTeam({ ownerUid: a.uid, name: "Three" })).toEqual({
      ok: false,
      reason: "already_in_team",
    })
    const add = store.addTeamMember({ teamId: second.team.id, actorUid: b.uid, targetUserId: a.userId })
    expect(add.ok).toBe(false)
    if (!add.ok) expect(add.reason).toBe("in_other_team")
    expect(store.getTeamForUser(a.uid)?.team.id).toBe(first.team.id)
  })

  test("adding a teamless user by ID works and notifies them", () => {
    const store = openGatewayStore()
    const a = makeUser(store, "uid_a")
    const b = makeUser(store, "uid_b")
    const team = store.createTeam({ ownerUid: a.uid, name: "Core" })
    if (!team.ok) throw new Error("setup failed")
    const added = store.addTeamMember({ teamId: team.team.id, actorUid: a.uid, targetUserId: b.userId })
    if (!added.ok) throw new Error("add failed")
    expect(added.member.role).toBe("member")
    expect(store.getTeamForUser(b.uid)?.team.id).toBe(team.team.id)
    const notes = payloads(store, b.uid)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.type).toBe("team_added")
    expect(notes[0]?.payload.teamName).toBe("Core")
    // Adding the same user again is a clean no-op refusal.
    expect(
      store.addTeamMember({ teamId: team.team.id, actorUid: a.uid, targetUserId: b.userId }),
    ).toEqual({ ok: false, reason: "already_member" })
    expect(store.listTeamMembers(team.team.id)).toHaveLength(2)
  })

  test("adding a user from another team notifies THEM, not just the inviter", () => {
    const store = openGatewayStore()
    const a = makeUser(store, "uid_a")
    const b = makeUser(store, "uid_b")
    const mine = store.createTeam({ ownerUid: a.uid, name: "Mine" })
    const theirs = store.createTeam({ ownerUid: b.uid, name: "Theirs" })
    if (!mine.ok || !theirs.ok) throw new Error("setup failed")
    const add = store.addTeamMember({ teamId: mine.team.id, actorUid: a.uid, targetUserId: b.userId })
    expect(add.ok).toBe(false)
    if (!add.ok) {
      expect(add.reason).toBe("in_other_team")
      expect(add.otherTeam?.name).toBe("Theirs")
    }
    const notes = payloads(store, b.uid)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.type).toBe("team_add_blocked")
    expect(notes[0]?.payload.teamName).toBe("Mine")
    expect(notes[0]?.payload.currentTeamName).toBe("Theirs")
  })

  test("only owners and admins can add; unknown IDs are refused", () => {
    const store = openGatewayStore()
    const a = makeUser(store, "uid_a")
    const b = makeUser(store, "uid_b")
    const c = makeUser(store, "uid_c")
    const team = store.createTeam({ ownerUid: a.uid, name: "Core" })
    if (!team.ok) throw new Error("setup failed")
    store.addTeamMember({ teamId: team.team.id, actorUid: a.uid, targetUserId: b.userId })
    // b is a plain member: cannot add c.
    expect(
      store.addTeamMember({ teamId: team.team.id, actorUid: b.uid, targetUserId: c.userId }),
    ).toEqual({ ok: false, reason: "not_authorized" })
    // Promote b to admin: now the add goes through.
    expect(
      store.setTeamMemberRole({ teamId: team.team.id, actorUid: a.uid, targetUid: b.uid, role: "admin" }),
    ).toEqual({ ok: true })
    expect(store.addTeamMember({ teamId: team.team.id, actorUid: b.uid, targetUserId: c.userId }).ok).toBe(true)
    expect(
      store.addTeamMember({ teamId: team.team.id, actorUid: a.uid, targetUserId: "gu_zzzzzzzzzz" }),
    ).toEqual({ ok: false, reason: "user_not_found" })
  })

  test("leaving frees the user to join another team; owners are guarded", () => {
    const store = openGatewayStore()
    const a = makeUser(store, "uid_a")
    const b = makeUser(store, "uid_b")
    const one = store.createTeam({ ownerUid: a.uid, name: "One" })
    const two = store.createTeam({ ownerUid: b.uid, name: "Two" })
    if (!one.ok || !two.ok) throw new Error("setup failed")
    // b owns Two, so adding b to One is refused and b stays put.
    const blocked = store.addTeamMember({ teamId: one.team.id, actorUid: a.uid, targetUserId: b.userId })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.reason).toBe("in_other_team")
    expect(store.getTeamForUser(b.uid)?.team.id).toBe(two.team.id)

    const c = makeUser(store, "uid_c")
    store.addTeamMember({ teamId: one.team.id, actorUid: a.uid, targetUserId: c.userId })
    expect(store.leaveTeam({ uid: c.uid })).toEqual({ ok: true, dissolved: false })
    expect(store.getTeamForUser(c.uid)).toBeUndefined()
    // Now c can be added to Two.
    expect(store.addTeamMember({ teamId: two.team.id, actorUid: b.uid, targetUserId: c.userId }).ok).toBe(true)
    // Owner of Two (with a member) cannot just leave.
    expect(store.leaveTeam({ uid: b.uid })).toEqual({ ok: false, reason: "owner_must_transfer" })
    // Transfer, then leaving works.
    expect(
      store.transferTeamOwnership({ teamId: two.team.id, actorUid: b.uid, targetUid: c.uid }),
    ).toEqual({ ok: true })
    expect(store.leaveTeam({ uid: b.uid })).toEqual({ ok: true, dissolved: false })
    expect(store.getTeamForUser(c.uid)?.membership.role).toBe("owner")
  })

  test("a sole owner leaving dissolves the team", () => {
    const store = openGatewayStore()
    const a = makeUser(store, "uid_a")
    const team = store.createTeam({ ownerUid: a.uid, name: "Solo" })
    if (!team.ok) throw new Error("setup failed")
    expect(store.leaveTeam({ uid: a.uid })).toEqual({ ok: true, dissolved: true })
    expect(store.getTeamForUser(a.uid)).toBeUndefined()
    expect(store.createTeam({ ownerUid: a.uid, name: "Again" }).ok).toBe(true)
  })

  test("owners can remove members; the owner cannot be removed", () => {
    const store = openGatewayStore()
    const a = makeUser(store, "uid_a")
    const b = makeUser(store, "uid_b")
    const team = store.createTeam({ ownerUid: a.uid, name: "Core" })
    if (!team.ok) throw new Error("setup failed")
    store.addTeamMember({ teamId: team.team.id, actorUid: a.uid, targetUserId: b.userId })
    expect(
      store.removeTeamMember({ teamId: team.team.id, actorUid: b.uid, targetUid: a.uid }),
    ).toEqual({ ok: false, reason: "cannot_remove_owner" })
    expect(
      store.removeTeamMember({ teamId: team.team.id, actorUid: a.uid, targetUid: b.uid }),
    ).toEqual({ ok: true })
    expect(store.getTeamForUser(b.uid)).toBeUndefined()
    expect(payloads(store, b.uid).some((note) => note.type === "team_removed")).toBe(true)
  })
})

describe("teams HTTP API", () => {
  const USERS: Record<string, { localId: string; email: string }> = {
    tok_a: { localId: "uid_a", email: "a@example.com" },
    tok_b: { localId: "uid_b", email: "b@example.com" },
    tok_c: { localId: "uid_c", email: "c@example.com" },
  }
  process.env.FIREBASE_API_KEY = "key"
  process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
  process.env.FIREBASE_PROJECT_ID = "grist-test"
  process.env.FIREBASE_APP_ID = "1:1:web:abc"
  afterAll(() => {
    delete process.env.FIREBASE_API_KEY
    delete process.env.FIREBASE_AUTH_DOMAIN
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_APP_ID
  })

  function gateway() {
    return createGateway({
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

  async function call(
    fetchImpl: (req: Request) => Promise<Response>,
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await fetchImpl(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
    return { status: response.status, json: (await response.json()) as Record<string, unknown> }
  }

  async function userId(fetchImpl: (req: Request) => Promise<Response>, token: string): Promise<string> {
    const session = await call(fetchImpl, "/v1/auth/session", { id_token: token })
    const id = session.json.user_id
    if (typeof id !== "string") throw new Error("session carried no user_id")
    return id
  }

  test("session carries the public user ID; teams flow end to end", async () => {
    const gw = gateway()
    const aId = await userId(gw.fetch, "tok_a")
    const bId = await userId(gw.fetch, "tok_b")
    expect(aId).toMatch(/^gu_/)

    const created = await call(gw.fetch, "/v1/teams", { id_token: "tok_a", name: "Core" })
    expect(created.status).toBe(201)
    const team = created.json.team as { name: string; role: string; members: unknown[] }
    expect(team.name).toBe("Core")
    expect(team.role).toBe("owner")
    expect(team.members).toHaveLength(1)

    const added = await call(gw.fetch, "/v1/teams/members", { id_token: "tok_a", user_id: bId })
    expect(added.status).toBe(200)
    expect((added.json.team as { members: unknown[] }).members).toHaveLength(2)

    // b got the team_added notification.
    const notes = await call(gw.fetch, "/v1/notifications", { id_token: "tok_b" })
    const list = notes.json.notifications as { id: string; type: string; read: boolean }[]
    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("team_added")
    const read = await call(gw.fetch, "/v1/notifications/read", {
      id_token: "tok_b",
      id: list[0]?.id,
    })
    expect(read.status).toBe(200)
    const after = await call(gw.fetch, "/v1/notifications", { id_token: "tok_b" })
    expect((after.json.notifications as { read: boolean }[])[0]?.read).toBe(true)

    // A plain member cannot add; an unknown token is unauthorized.
    const cId = await userId(gw.fetch, "tok_c")
    const byMember = await call(gw.fetch, "/v1/teams/members", { id_token: "tok_b", user_id: cId })
    expect(byMember.status).toBe(403)
    const anon = await call(gw.fetch, "/v1/teams/mine", {})
    expect(anon.status).toBe(401)
  })

  test("team usage: owner sees every member, member sees total + own row", async () => {
    const store = openGatewayStore(":memory:")
    const gw = createGateway({
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
    const sessionA = await call(gw.fetch, "/v1/auth/session", { id_token: "tok_a" })
    const sessionB = await call(gw.fetch, "/v1/auth/session", { id_token: "tok_b" })
    const bId = sessionB.json.user_id as string
    for (const [session, usd] of [
      [sessionA, 3.5],
      [sessionB, 1.25],
    ] as const) {
      store.addSpend({
        code: session.json.code as string,
        model: "gate/route",
        rung: "cheapest",
        inputTokens: 0,
        outputTokens: 0,
        usd,
      })
    }
    await call(gw.fetch, "/v1/teams", { id_token: "tok_a", name: "Spenders" })
    await call(gw.fetch, "/v1/teams/members", { id_token: "tok_a", user_id: bId })

    const ownerView = await call(gw.fetch, "/v1/teams/usage", { id_token: "tok_a" })
    expect(ownerView.status).toBe(200)
    expect(ownerView.json.total_spent_usd).toBeCloseTo(4.75)
    expect(ownerView.json.members as unknown[]).toHaveLength(2)

    const memberView = await call(gw.fetch, "/v1/teams/usage", { id_token: "tok_b" })
    expect(memberView.json.total_spent_usd).toBeCloseTo(4.75)
    const rows = memberView.json.members as { spent_usd: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.spent_usd).toBeCloseTo(1.25)
  })

  test("team key sharing: members run on the owner's provider key", async () => {
    const gw = createGateway({
      masterKey: parseMasterKey("ab".repeat(32)) as Buffer,
      fetch: async (_input: string, init?: RequestInit) => {
        const token = (JSON.parse(String(init?.body)) as { idToken?: string }).idToken ?? ""
        const user = USERS[token]
        return new Response(JSON.stringify({ users: user ? [user] : [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      },
    })
    async function byInvite(
      method: string,
      path: string,
      code: string,
      body?: Record<string, unknown>,
    ): Promise<{ status: number; json: Record<string, unknown> }> {
      const response = await gw.fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers: { "Content-Type": "application/json", "X-Grist-Invite": code },
          body: body ? JSON.stringify(body) : undefined,
        }),
      )
      return { status: response.status, json: (await response.json()) as Record<string, unknown> }
    }
    const sessionA = await call(gw.fetch, "/v1/auth/session", { id_token: "tok_a" })
    const sessionB = await call(gw.fetch, "/v1/auth/session", { id_token: "tok_b" })
    const aCode = sessionA.json.code as string
    const bCode = sessionB.json.code as string
    await call(gw.fetch, "/v1/teams", { id_token: "tok_a", name: "Keysharers" })
    await call(gw.fetch, "/v1/teams/members", {
      id_token: "tok_a",
      user_id: sessionB.json.user_id as string,
    })

    // Before the owner attaches a key, the member has no team key.
    const before = await byInvite("GET", "/v1/provider", bCode)
    expect(before.json.team_key).toBeNull()
    const usageBefore = await byInvite("GET", "/v1/usage", bCode)
    expect(usageBefore.json.provider).toBeNull()
    expect(usageBefore.json.provider_source).toBeNull()

    // The owner attaches an OpenRouter key.
    const attach = await byInvite("POST", "/v1/provider", aCode, {
      provider: "openrouter",
      api_key: "sk-or-team-key",
    })
    expect(attach.status).toBe(200)

    // The member now resolves to the owner's key, with none of their own.
    const after = await byInvite("GET", "/v1/provider", bCode)
    expect(after.json.provider).toBeNull()
    const teamKey = after.json.team_key as { team_name: string; provider: string } | null
    expect(teamKey?.team_name).toBe("Keysharers")
    expect(teamKey?.provider).toBe("openrouter")
    const usageAfter = await byInvite("GET", "/v1/usage", bCode)
    expect(usageAfter.json.provider).toBe("openrouter")
    expect(usageAfter.json.provider_source).toBe("team")

    // The owner's own view is unchanged: their key, no team key.
    const owner = await byInvite("GET", "/v1/provider", aCode)
    expect(owner.json.provider).toBe("openrouter")
    expect(owner.json.team_key).toBeNull()
    const ownerUsage = await byInvite("GET", "/v1/usage", aCode)
    expect(ownerUsage.json.provider_source).toBe("own")
  })

  test("a member's completion rides the owner's key but meters to the member", async () => {
    let upstreamAuth = ""
    const gw = createGateway({
      masterKey: parseMasterKey("ab".repeat(32)) as Buffer,
      fetch: async (input: string, init?: RequestInit) => {
        if (String(input).includes("identitytoolkit")) {
          const token = (JSON.parse(String(init?.body)) as { idToken?: string }).idToken ?? ""
          const user = USERS[token]
          return new Response(JSON.stringify({ users: user ? [user] : [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        upstreamAuth = new Headers(init?.headers).get("Authorization") ?? ""
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1000, completion_tokens: 500 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      },
    })
    const sessionA = await call(gw.fetch, "/v1/auth/session", { id_token: "tok_a" })
    const sessionB = await call(gw.fetch, "/v1/auth/session", { id_token: "tok_b" })
    const aCode = sessionA.json.code as string
    const bCode = sessionB.json.code as string
    await call(gw.fetch, "/v1/teams", { id_token: "tok_a", name: "Riders" })
    await call(gw.fetch, "/v1/teams/members", {
      id_token: "tok_a",
      user_id: sessionB.json.user_id as string,
    })
    const attach = await gw.fetch(
      new Request("http://localhost/v1/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Grist-Invite": aCode },
        body: JSON.stringify({ provider: "openrouter", api_key: "sk-or-team-key" }),
      }),
    )
    expect(attach.status).toBe(200)

    const completion = await gw.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Grist-Invite": bCode },
        body: JSON.stringify({ model: "cheapest", messages: [], stream: false }),
      }),
    )
    expect(completion.status).toBe(200)
    // The upstream call carried the OWNER's key…
    expect(upstreamAuth).toBe("Bearer sk-or-team-key")
    // …while the spend metered to the member's own account, not the owner's.
    expect(gw.store.getInvite(bCode)?.spent_usd).toBeGreaterThan(0)
    expect(gw.store.getInvite(aCode)?.spent_usd).toBe(0)
  })

  test("member adds are rate-limited per actor (notification spam guard)", async () => {
    const gw = gateway()
    const bId = await userId(gw.fetch, "tok_b")
    await call(gw.fetch, "/v1/teams", { id_token: "tok_a", name: "Spamguard" })
    let last = 0
    for (let attempt = 0; attempt < 31; attempt++) {
      const res = await call(gw.fetch, "/v1/teams/members", { id_token: "tok_a", user_id: bId })
      last = res.status
    }
    // First add succeeds, repeats 409 as already-member — the 31st is the
    // rate limit kicking in at 30/hour.
    expect(last).toBe(429)
  })

  test("adding a user from another team 409s and notifies that user", async () => {
    const gw = gateway()
    const aId = await userId(gw.fetch, "tok_a")
    const cId = await userId(gw.fetch, "tok_c")
    void aId
    await call(gw.fetch, "/v1/teams", { id_token: "tok_a", name: "Mine" })
    await call(gw.fetch, "/v1/teams", { id_token: "tok_c", name: "Theirs" })
    const blocked = await call(gw.fetch, "/v1/teams/members", { id_token: "tok_a", user_id: cId })
    expect(blocked.status).toBe(409)
    expect(blocked.json.other_team_name).toBe("Theirs")
    const notes = await call(gw.fetch, "/v1/notifications", { id_token: "tok_c" })
    const list = notes.json.notifications as { type: string }[]
    expect(list.map((note) => note.type)).toContain("team_add_blocked")
    // c leaves theirs (sole owner: dissolves), then the add succeeds.
    const left = await call(gw.fetch, "/v1/teams/leave", { id_token: "tok_c" })
    expect(left.status).toBe(200)
    const added = await call(gw.fetch, "/v1/teams/members", { id_token: "tok_a", user_id: cId })
    expect(added.status).toBe(200)
  })
})

describe("notifications", () => {
  test("list is newest-first and mark-read is owner-scoped", () => {
    const store = openGatewayStore()
    const a = makeUser(store, "uid_a")
    store.createNotification({ uid: a.uid, type: "one", payload: { n: 1 } })
    store.createNotification({ uid: a.uid, type: "two", payload: { n: 2 } })
    const rows = store.listNotifications(a.uid)
    expect(rows.map((row) => row.type)).toEqual(["two", "one"])
    const first = rows[0]
    if (!first) throw new Error("missing notification")
    expect(store.markNotificationRead("someone_else", first.id)).toBe(false)
    expect(store.markNotificationRead(a.uid, first.id)).toBe(true)
    expect(store.markNotificationRead(a.uid, first.id)).toBe(false)
    expect(store.listNotifications(a.uid)[0]?.read_at).not.toBeNull()
  })
})
