import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { createGateway } from "./http.js"
import { runInboxExpirySweep } from "./policy.js"
import { openGatewayStore } from "./store.js"

/**
 * S-INBOX1 (next-block spec §7, D6 Option 2): the approvals inbox for
 * cross-boundary actions in unattended runs. Envelope breaches park
 * instead of refusing; questions from unattended runs post and park;
 * decisions are human-only (account credential, never a delegated
 * API key) and scoped to the run's creator or team owner/admins; an
 * undecided park fails closed on timeout.
 */

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

async function post(
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

const CEILING = { max_runs_per_day: 20, max_spend_per_day_usd: 25, max_spend_per_run_usd: 5 }

function definition(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 1,
    trigger: { source: "github", event: "ci_failure" },
    filter: { repo: "acme/widgets", workflow: "CI", branch: "main" },
    target: { environment: "sandbox", prompt_template: "Investigate the failing CI run." },
    envelope: { max_runs_per_day: 10, max_spend_per_day_usd: 10, max_spend_per_run_usd: 2 },
    enabled: true,
    ...overrides,
  }
}

function setup() {
  const store = openGatewayStore()
  const gw = createGateway({ store })
  const owner = makeAccount(store, "uid_owner")
  const member = makeAccount(store, "uid_member")
  const teamId = makeTeam(store, owner, [member])
  store.setListenerCeiling(teamId, CEILING)
  const secret = store.ensureTeamWebhookSecret(teamId).secret
  return { store, gw, owner, member, teamId, secret }
}

type Setup = ReturnType<typeof setup>

async function pushListener(s: Setup, envelope: Record<string, unknown>) {
  const res = await post(s.gw, "/v1/team-objects/push", s.owner.code, {
    objects: [
      {
        id: "lis_1",
        kind: "listener",
        container: "acme/widgets",
        name: "ci-failure",
        body: JSON.stringify(definition({ envelope })),
        metadata: {},
      },
    ],
  })
  expect((res.json.results as { result: string }[])[0]?.result).toBe("stored")
}

async function deliverQueued(s: Setup, deliveryId: string): Promise<string> {
  const raw = JSON.stringify({
    action: "completed",
    workflow_run: {
      name: "CI",
      head_branch: "main",
      conclusion: "failure",
      status: "completed",
      html_url: "https://github.com/acme/widgets/actions/runs/42",
      head_sha: "abc123",
    },
    repository: { full_name: "acme/widgets" },
  })
  const response = await s.gw.fetch(
    new Request(`http://localhost/v1/webhooks/github/${s.teamId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": "workflow_run",
        "X-Hub-Signature-256": `sha256=${createHmac("sha256", s.secret).update(raw).digest("hex")}`,
      },
      body: raw,
    }),
  )
  const json = (await response.json()) as Record<string, unknown>
  expect(json.queued).toBe(1)
  return (json.request_ids as string[])[0] as string
}

async function claim(s: Setup, code: string, requestId: string): Promise<CallResult> {
  return post(s.gw, "/v1/listeners/requests/claim", code, { request_id: requestId })
}

async function complete(s: Setup, code: string, requestId: string, spend: number): Promise<CallResult> {
  return post(s.gw, "/v1/listeners/requests/complete", code, {
    request_id: requestId,
    spend_usd: spend,
    outcome: "succeeded",
  })
}

/** Queue two requests under a 1-run/day envelope and park the second. */
async function parkedBreach(s: Setup): Promise<{ requestId: string; itemId: string }> {
  await pushListener(s, { max_runs_per_day: 1, max_spend_per_day_usd: 10, max_spend_per_run_usd: 2 })
  const first = await deliverQueued(s, "delivery-1")
  await claim(s, s.owner.code, first)
  await complete(s, s.owner.code, first, 0.5)
  const second = await deliverQueued(s, "delivery-2")
  const parked = await claim(s, s.owner.code, second)
  expect(parked.json.parked).toBe(true)
  return { requestId: second, itemId: parked.json.inbox_item_id as string }
}

function inboxAudit(store: Store, teamId: string) {
  return store.teamMemoryAudit(teamId).filter((row) => row.kind === "inbox")
}

function notificationTypes(store: Store, uid: string): string[] {
  return store.listNotifications(uid).map((row) => row.type)
}

describe("envelope-breach parks (next-block spec §7, S-INBOX1)", () => {
  test("a parked request is not claimable, and its item is listed with the breach facts", async () => {
    const s = setup()
    const { requestId, itemId } = await parkedBreach(s)

    const again = await claim(s, s.owner.code, requestId)
    expect(again.status).toBe(409)

    const list = await post(s.gw, "/v1/inbox/list", s.owner.code, { state: "pending" })
    expect(list.status).toBe(200)
    const items = list.json.items as Record<string, unknown>[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: itemId,
      source: "envelope_breach",
      boundary: "spend-beyond-envelope",
      state: "pending",
      request_id: requestId,
      creator_user_id: s.owner.userId,
    })
    expect((items[0]?.detail as Record<string, unknown>).reason).toBe("max_runs_per_day")
    // firebase_uid never leaves the server.
    expect(JSON.stringify(items[0])).not.toContain(s.owner.uid)

    const audit = inboxAudit(s.store, s.teamId)
    expect(audit.map((row) => row.action)).toEqual(["parked"])
    expect(audit[0]?.actor_uid).toBe("gateway")
    expect(notificationTypes(s.store, s.owner.uid)).toContain("inbox_item_parked")
  })

  test("approve releases the request to claimable and the waiver carries the claim", async () => {
    const s = setup()
    const { requestId, itemId } = await parkedBreach(s)

    const decided = await post(s.gw, "/v1/inbox/decide", s.owner.code, {
      item_id: itemId,
      decision: "approve",
    })
    expect(decided.status).toBe(200)
    expect((decided.json.item as Record<string, unknown>).state).toBe("approved")
    expect((decided.json.request as Record<string, unknown>).state).toBe("queued")

    const row = s.store.getListenerRunRequest(s.teamId, requestId)
    expect(row?.approved_reason).toBe("max_runs_per_day")

    // The daily cap is still exhausted — the claim succeeds on the
    // strength of the human's waiver for exactly that breach.
    const claimed = await claim(s, s.owner.code, requestId)
    expect(claimed.json.claimed).toBe(true)
    const done = await complete(s, s.owner.code, requestId, 0.25)
    expect(done.json.completed).toBe(true)

    expect(inboxAudit(s.store, s.teamId).map((row) => row.action)).toEqual(["parked", "approved"])
    expect(notificationTypes(s.store, s.owner.uid)).toContain("inbox_item_resolved")
  })

  test("deny refuses the request with the refusal audit + notifications", async () => {
    const s = setup()
    const { requestId, itemId } = await parkedBreach(s)

    const decided = await post(s.gw, "/v1/inbox/decide", s.owner.code, {
      item_id: itemId,
      decision: "deny",
    })
    expect(decided.status).toBe(200)
    expect((decided.json.request as Record<string, unknown>).state).toBe("refused")

    const refused = s.store
      .teamMemoryAudit(s.teamId)
      .filter((row) => row.kind === "listener" && row.action === "refused_cap")
    expect(refused.map((row) => row.detail)).toEqual(["inbox_denied"])
    expect(inboxAudit(s.store, s.teamId).map((row) => row.action)).toEqual(["parked", "denied"])
    const types = notificationTypes(s.store, s.owner.uid)
    expect(types).toContain("listener_request_refused")
    expect(types).toContain("inbox_item_resolved")

    // A decided item cannot be decided again.
    const twice = await post(s.gw, "/v1/inbox/decide", s.owner.code, {
      item_id: itemId,
      decision: "approve",
    })
    expect(twice.status).toBe(409)
  })

  test("an undecided park expires on TTL and fails closed, exactly like a denial", async () => {
    const s = setup()
    const { requestId } = await parkedBreach(s)

    const swept = runInboxExpirySweep(s.store, { now: Date.now() + 73 * 3_600_000 })
    expect(swept.expired).toBe(1)

    const row = s.store.getListenerRunRequest(s.teamId, requestId)
    expect(row?.state).toBe("refused")
    const refused = s.store
      .teamMemoryAudit(s.teamId)
      .filter((r) => r.kind === "listener" && r.action === "refused_cap")
    expect(refused.map((r) => r.detail)).toEqual(["inbox_expired"])
    expect(inboxAudit(s.store, s.teamId).map((r) => r.action)).toEqual(["parked", "expired"])
    expect(notificationTypes(s.store, s.owner.uid)).toContain("inbox_item_resolved")
    // Nothing executed: the request was never claimed.
    const claimed = s.store
      .teamMemoryAudit(s.teamId)
      .filter((r) => r.kind === "listener" && r.action === "claimed")
    expect(claimed).toHaveLength(1) // only the first request
  })
})

describe("question items (next-block spec §7 sources 2 + 3)", () => {
  test("a run posts a question; the creator's answer is recorded on the item", async () => {
    const s = setup()
    await pushListener(s, { max_runs_per_day: 10, max_spend_per_day_usd: 10, max_spend_per_run_usd: 2 })
    const requestId = await deliverQueued(s, "delivery-1")

    // The member's runner posts on behalf of the owner's run — the
    // item still belongs to the run's creator.
    const posted = await post(s.gw, "/v1/inbox/items", s.member.code, {
      source: "ask_human",
      boundary: "write-outside-environment",
      question: "The run stopped on an unanswered permission ask for a path outside its environment.",
      request_id: requestId,
      session_id: "ses_parked",
    })
    expect(posted.status).toBe(200)
    const item = posted.json.item as Record<string, unknown>
    expect(item).toMatchObject({
      source: "ask_human",
      boundary: "write-outside-environment",
      state: "pending",
      request_id: requestId,
      session_id: "ses_parked",
      creator_user_id: s.owner.userId,
    })
    expect(notificationTypes(s.store, s.owner.uid)).toContain("inbox_item_parked")

    // Approving a question without an answer releases nothing.
    const noAnswer = await post(s.gw, "/v1/inbox/decide", s.owner.code, {
      item_id: item.id,
      decision: "approve",
    })
    expect(noAnswer.status).toBe(400)

    const decided = await post(s.gw, "/v1/inbox/decide", s.owner.code, {
      item_id: item.id,
      decision: "approve",
      answer: "Yes — read-only access to that path is fine.",
    })
    expect(decided.status).toBe(200)
    const decidedItem = decided.json.item as Record<string, unknown>
    expect(decidedItem.state).toBe("approved")
    expect(decidedItem.answer).toBe("Yes — read-only access to that path is fine.")
    const audit = inboxAudit(s.store, s.teamId)
    expect(audit.map((row) => row.action)).toEqual(["parked", "approved"])
    // The answer text itself never lands on the audit trail.
    expect(JSON.stringify(audit)).not.toContain("read-only access")
  })

  test("posting rejects the envelope source, unknown boundaries, and connector keys", async () => {
    const s = setup()
    const breach = await post(s.gw, "/v1/inbox/items", s.owner.code, {
      source: "envelope_breach",
      boundary: "spend-beyond-envelope",
      question: "forged park",
    })
    expect(breach.status).toBe(400)

    const boundary = await post(s.gw, "/v1/inbox/items", s.owner.code, {
      source: "question",
      boundary: "delete-production",
      question: "not a cross-boundary kind",
    })
    expect(boundary.status).toBe(400)

    const minted = s.store.createApiKey({ inviteCode: s.owner.code, name: "agent", kind: "connector" })
    const connector = await post(
      s.gw,
      "/v1/inbox/items",
      undefined,
      { source: "question", boundary: "send", question: "via connector" },
      { "X-Grist-Api-Key": minted?.secret ?? "" },
    )
    expect(connector.status).toBe(403)
  })

  test("an unanswered question expires closed — nothing resumes", async () => {
    const s = setup()
    const posted = await post(s.gw, "/v1/inbox/items", s.owner.code, {
      source: "question",
      boundary: "deploy",
      question: "Deploy the fix to production?",
      session_id: "ses_waiting",
    })
    expect(posted.status).toBe(200)
    const swept = runInboxExpirySweep(s.store, { now: Date.now() + 73 * 3_600_000 })
    expect(swept.expired).toBe(1)
    const item = s.store.getInboxItem(s.teamId, (posted.json.item as Record<string, unknown>).id as string)
    expect(item?.state).toBe("expired")
    expect(item?.answer).toBeNull()
  })
})

describe("decision authority (next-block spec §7)", () => {
  test("a delegated API key cannot decide, even the account's own", async () => {
    const s = setup()
    const { itemId } = await parkedBreach(s)
    const minted = s.store.createApiKey({ inviteCode: s.owner.code, name: "agent" })
    const decided = await post(
      s.gw,
      "/v1/inbox/decide",
      undefined,
      { item_id: itemId, decision: "approve" },
      { "X-Grist-Api-Key": minted?.secret ?? "" },
    )
    expect(decided.status).toBe(403)
    expect(decided.json.reason).toBe("deciding_requires_account_auth")
    // The item is untouched.
    expect(s.store.getInboxItem(s.teamId, itemId)?.state).toBe("pending")
  })

  test("standing: a plain member cannot decide another member's park; an admin can", async () => {
    const s = setup()
    const { itemId } = await parkedBreach(s)

    const byMember = await post(s.gw, "/v1/inbox/decide", s.member.code, {
      item_id: itemId,
      decision: "deny",
    })
    expect(byMember.status).toBe(403)
    expect(s.store.getInboxItem(s.teamId, itemId)?.state).toBe("pending")

    const role = s.store.setTeamMemberRole({
      teamId: s.teamId,
      actorUid: s.owner.uid,
      targetUid: s.member.uid,
      role: "admin",
    })
    expect(role.ok).toBe(true)
    const byAdmin = await post(s.gw, "/v1/inbox/decide", s.member.code, {
      item_id: itemId,
      decision: "deny",
    })
    expect(byAdmin.status).toBe(200)
    expect(s.store.getInboxItem(s.teamId, itemId)?.state).toBe("denied")
  })

  test("items are tenancy-scoped: another team's member sees nothing", async () => {
    const s = setup()
    const { itemId } = await parkedBreach(s)
    const outsider = makeAccount(s.store, "uid_outsider")
    makeTeam(s.store, outsider, [])
    const list = await post(s.gw, "/v1/inbox/list", outsider.code, {})
    expect((list.json.items as unknown[]).length).toBe(0)
    const get = await post(s.gw, "/v1/inbox/get", outsider.code, { item_id: itemId })
    expect(get.status).toBe(404)
  })
})
