import { Database } from "bun:sqlite"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash, createHmac } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createGateway } from "./http.js"
import {
  listenerTriggerMatches,
  normalizeGenericEvent,
  normalizeGithubEvent,
  parseListenerDefinition,
} from "./listeners.js"
import { runListenerExpirySweep } from "./policy.js"
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

function listenerObject(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "lis_1",
    kind: "listener",
    container: "acme/widgets",
    name: "ci-failure",
    body: JSON.stringify(definition()),
    metadata: {},
    ...overrides,
  }
}

async function pushObjects(
  gw: Gateway,
  code: string,
  objects: Record<string, unknown>[],
  headers?: Record<string, string>,
): Promise<CallResult> {
  return post(gw, "/v1/team-objects/push", code, { objects }, headers)
}

function pushResults(res: CallResult): { id: string | null; result: string; reason?: string }[] {
  return res.json.results as { id: string | null; result: string; reason?: string }[]
}

function sign(secret: string, raw: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`
}

function githubFailurePayload(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
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
    ...overrides,
  }
}

async function deliver(
  gw: Gateway,
  teamId: string,
  input: {
    source?: "github" | "generic"
    raw: string
    secret?: string
    deliveryId?: string
    event?: string
    signature?: string | null
  },
): Promise<CallResult> {
  const source = input.source ?? "github"
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (input.deliveryId) {
    headers[source === "github" ? "X-GitHub-Delivery" : "X-Grist-Delivery"] = input.deliveryId
  }
  if (input.event) headers["X-GitHub-Event"] = input.event
  const signature =
    input.signature === undefined && input.secret ? sign(input.secret, input.raw) : input.signature
  if (signature) {
    headers[source === "github" ? "X-Hub-Signature-256" : "X-Grist-Signature-256"] = signature
  }
  const response = await gw.fetch(
    new Request(`http://localhost/v1/webhooks/${source}/${teamId}`, {
      method: "POST",
      headers,
      body: input.raw,
    }),
  )
  return { status: response.status, json: (await response.json()) as Record<string, unknown> }
}

async function queue(gw: Gateway, code: string): Promise<Record<string, unknown>[]> {
  const res = await post(gw, "/v1/listeners/requests/list", code, {})
  expect(res.status).toBe(200)
  return res.json.requests as Record<string, unknown>[]
}

function listenerAudit(store: Store, teamId: string) {
  return store.teamMemoryAudit(teamId).filter((row) => row.kind === "listener")
}

/** A team with ceiling set, webhook intake configured, and one enabled
 * GitHub CI-failure listener authored by the owner. */
function intakeSetup() {
  const store = openGatewayStore()
  const gw = createGateway({ store })
  const owner = makeAccount(store, "uid_owner")
  const member = makeAccount(store, "uid_member")
  const teamId = makeTeam(store, owner, [member])
  store.setListenerCeiling(teamId, CEILING)
  const secret = store.ensureTeamWebhookSecret(teamId).secret
  return { store, gw, owner, member, teamId, secret }
}

async function pushEnabledListener(setup: ReturnType<typeof intakeSetup>) {
  const pushed = await pushObjects(setup.gw, setup.owner.code, [listenerObject()])
  expect(pushResults(pushed)).toEqual([{ id: "lis_1", result: "stored" }])
}

describe("listener definition parsing", () => {
  test("parses a full definition; enabled defaults off, target defaults empty", () => {
    const parsed = parseListenerDefinition(JSON.stringify(definition()))
    expect(parsed?.trigger).toEqual({ source: "github", event: "ci_failure" })
    expect(parsed?.filter.repo).toBe("acme/widgets")
    expect(parsed?.enabled).toBe(true)
    const minimal = parseListenerDefinition(
      JSON.stringify({
        trigger: { source: "generic", event: "issue_opened" },
        filter: { repo: "acme/widgets" },
        envelope: { max_runs_per_day: 1, max_spend_per_day_usd: 1, max_spend_per_run_usd: 1 },
      }),
    )
    expect(minimal?.enabled).toBe(false)
    expect(minimal?.target).toEqual({})
  })

  test("rejects malformed definitions", () => {
    const cases: unknown[] = [
      "not json",
      JSON.stringify({}),
      // Missing envelope — caps are required, never defaulted (D16).
      JSON.stringify({
        trigger: { source: "github", event: "ci_failure" },
        filter: { repo: "acme/widgets" },
      }),
      // Per-run above per-day is nonsense.
      JSON.stringify(
        definition({
          envelope: { max_runs_per_day: 1, max_spend_per_day_usd: 1, max_spend_per_run_usd: 2 },
        }),
      ),
      // Events outside the D8 set are not admissible triggers.
      JSON.stringify(definition({ trigger: { source: "github", event: "push" } })),
      JSON.stringify(definition({ filter: { repo: "no-slash" } })),
      JSON.stringify(definition({ enabled: "yes" })),
      JSON.stringify(definition({ version: 2 })),
    ]
    for (const body of cases) {
      expect(parseListenerDefinition(body as string)).toBeUndefined()
    }
  })
})

describe("event normalization and matching", () => {
  test("workflow_run completed/failure normalizes to ci_failure with its facts", () => {
    const event = normalizeGithubEvent("workflow_run", githubFailurePayload())
    expect(event.kind).toBe("ci_failure")
    expect(event.repo).toBe("acme/widgets")
    expect(event.workflow).toBe("CI")
    expect(event.branch).toBe("main")
    expect(event.conclusion).toBe("failure")
    const success = normalizeGithubEvent(
      "workflow_run",
      githubFailurePayload({
        workflow_run: {
          name: "CI",
          head_branch: "main",
          conclusion: "success",
          html_url: "https://example.com/run",
        },
      }),
    )
    expect(success.kind).toBe("workflow_run")
  })

  test("issues and pull_request opened/labeled map to their kinds", () => {
    const labeled = normalizeGithubEvent("issues", {
      action: "labeled",
      label: { name: "bug" },
      issue: { title: "Crash", html_url: "https://example.com/i/1", labels: [{ name: "bug" }] },
      repository: { full_name: "acme/widgets" },
    })
    expect(labeled.kind).toBe("issue_labeled")
    expect(labeled.label).toBe("bug")
    expect(labeled.labels).toEqual(["bug"])
    const opened = normalizeGithubEvent("pull_request", {
      action: "opened",
      pull_request: { title: "Fix", html_url: "https://example.com/p/2", head: { ref: "feat/x" }, labels: [] },
      repository: { full_name: "acme/widgets" },
    })
    expect(opened.kind).toBe("pr_opened")
    expect(opened.branch).toBe("feat/x")
  })

  test("matching is deterministic: repo case-insensitive, predicates exact", () => {
    const parsed = parseListenerDefinition(JSON.stringify(definition()))
    if (!parsed) throw new Error("definition should parse")
    const event = normalizeGithubEvent("workflow_run", githubFailurePayload())
    expect(listenerTriggerMatches(parsed, event)).toBe(true)
    const otherBranch = normalizeGithubEvent(
      "workflow_run",
      githubFailurePayload({
        workflow_run: { name: "CI", head_branch: "dev", conclusion: "failure", html_url: "u" },
      }),
    )
    expect(listenerTriggerMatches(parsed, otherBranch)).toBe(false)
    // Enabled is not part of the trigger match — intake checks it apart.
    const disabled = parseListenerDefinition(JSON.stringify(definition({ enabled: false })))
    if (!disabled) throw new Error("definition should parse")
    expect(listenerTriggerMatches(disabled, event)).toBe(true)
    // A generic event never matches a github trigger, even with equal facts.
    const generic = normalizeGenericEvent({ repo: "acme/widgets", kind: "ci_failure" })
    expect(listenerTriggerMatches(parsed, generic)).toBe(false)
  })
})

describe("listener admission (next-block spec §6.4)", () => {
  test("a listener object pushes, pulls, and counts like any other kind", async () => {
    const setup = intakeSetup()
    await pushEnabledListener(setup)
    const pulled = await post(setup.gw, "/v1/team-objects/pull", setup.owner.code, {
      since_seq: 0,
      kinds: ["listener"],
    })
    const objects = pulled.json.objects as { id: string; kind: string }[]
    expect(objects.map((o) => o.id)).toEqual(["lis_1"])
    expect(objects[0]?.kind).toBe("listener")
    expect(setup.store.teamObjectCounts(setup.teamId).byKind.listener).toBe(1)
  })

  test("a malformed definition body is rejected as invalid_schema", async () => {
    const { gw, owner } = intakeSetup()
    const res = await pushObjects(gw, owner.code, [
      listenerObject({ body: JSON.stringify({ trigger: { source: "github" } }) }),
    ])
    expect(pushResults(res)).toEqual([
      { id: "lis_1", result: "rejected", reason: "invalid_schema" },
    ])
  })

  test("an enabled listener with no team ceiling is rejected: ceiling_required", async () => {
    const store = openGatewayStore()
    const gw = createGateway({ store })
    const owner = makeAccount(store, "uid_owner")
    makeTeam(store, owner, [])
    const res = await pushObjects(gw, owner.code, [listenerObject()])
    expect(pushResults(res)).toEqual([
      { id: "lis_1", result: "rejected", reason: "ceiling_required" },
    ])
    // A disabled (proposed) listener is admissible without a ceiling.
    const proposed = await pushObjects(gw, owner.code, [
      listenerObject({ id: "lis_2", body: JSON.stringify(definition({ enabled: false })) }),
    ])
    expect(pushResults(proposed)).toEqual([{ id: "lis_2", result: "stored" }])
  })

  test("an envelope above the team ceiling is rejected, enabled or not", async () => {
    const { gw, owner } = intakeSetup()
    const greedy = definition({
      envelope: { max_runs_per_day: 10, max_spend_per_day_usd: 100, max_spend_per_run_usd: 2 },
    })
    const res = await pushObjects(gw, owner.code, [
      listenerObject({ body: JSON.stringify(greedy) }),
    ])
    expect(pushResults(res)).toEqual([
      { id: "lis_1", result: "rejected", reason: "envelope_exceeds_ceiling" },
    ])
  })

  test("an API key can propose a listener but cannot enable one (§6.5)", async () => {
    const { gw, owner, store } = intakeSetup()
    const minted = store.createApiKey({ inviteCode: owner.code, name: "agent" })
    if (!minted) throw new Error("key mint failed")
    const headers = { "X-Grist-Api-Key": minted.secret }
    const proposed = await pushObjects(
      gw,
      "",
      [listenerObject({ body: JSON.stringify(definition({ enabled: false })) })],
      headers,
    )
    expect(pushResults(proposed)).toEqual([{ id: "lis_1", result: "stored" }])
    const enabling = await pushObjects(
      gw,
      "",
      [listenerObject({ id: "lis_2", supersedes: "lis_1", body: JSON.stringify(definition()) })],
      headers,
    )
    expect(pushResults(enabling)).toEqual([
      { id: "lis_2", result: "rejected", reason: "enabling_requires_account_auth" },
    ])
    // The account holder's own credential enables it — as the next
    // version of the proposed listener's chain.
    const byHolder = await pushObjects(gw, owner.code, [
      listenerObject({ id: "lis_2", supersedes: "lis_1", body: JSON.stringify(definition()) }),
    ])
    expect(pushResults(byHolder)).toEqual([{ id: "lis_2", result: "stored" }])
  })
})

describe("webhook intake (next-block spec §6.1/§6.7)", () => {
  test("a signed CI-failure webhook queues exactly one run request, audited fired + queued", async () => {
    const setup = intakeSetup()
    await pushEnabledListener(setup)
    const raw = JSON.stringify(githubFailurePayload())
    const res = await deliver(setup.gw, setup.teamId, {
      raw,
      secret: setup.secret,
      deliveryId: "delivery-1",
      event: "workflow_run",
    })
    expect(res.status).toBe(200)
    expect(res.json.queued).toBe(1)
    const requestIds = res.json.request_ids as string[]
    expect(requestIds).toHaveLength(1)

    const requests = await queue(setup.gw, setup.owner.code)
    expect(requests).toHaveLength(1)
    const request = requests[0] as Record<string, unknown>
    expect(request.id).toBe(requestIds[0])
    expect(request.listener_id).toBe("lis_1")
    expect(request.state).toBe("queued")
    expect(request.creator_user_id).toBe(setup.owner.userId)
    expect(request.event_kind).toBe("ci_failure")
    expect(request.event).toEqual({
      kind: "ci_failure",
      repo: "acme/widgets",
      workflow: "CI",
      branch: "main",
      conclusion: "failure",
      url: "https://github.com/acme/widgets/actions/runs/42",
    })
    expect(request.envelope).toEqual({
      max_runs_per_day: 10,
      max_spend_per_day_usd: 10,
      max_spend_per_run_usd: 2,
    })
    expect(request.target).toEqual({
      environment: "sandbox",
      prompt_template: "Investigate the failing CI run.",
    })
    expect(request.payload_digest).toBe(createHash("sha256").update(raw).digest("hex"))

    const audit = listenerAudit(setup.store, setup.teamId)
    expect(audit.map((row) => row.action)).toEqual(["store", "fired", "queued"])
    expect(audit.find((row) => row.action === "fired")?.entry_id).toBe("lis_1")
    expect(audit.find((row) => row.action === "queued")?.entry_id).toBe(requestIds[0])
    expect(audit.every((row) => row.actor_uid === setup.owner.uid)).toBe(true)
  })

  test("a replayed delivery creates nothing and is audited as a drop", async () => {
    const setup = intakeSetup()
    await pushEnabledListener(setup)
    const raw = JSON.stringify(githubFailurePayload())
    const first = await deliver(setup.gw, setup.teamId, {
      raw,
      secret: setup.secret,
      deliveryId: "delivery-1",
      event: "workflow_run",
    })
    expect(first.json.queued).toBe(1)
    const replay = await deliver(setup.gw, setup.teamId, {
      raw,
      secret: setup.secret,
      deliveryId: "delivery-1",
      event: "workflow_run",
    })
    expect(replay.status).toBe(200)
    expect(replay.json.deduped).toBe(true)
    expect(await queue(setup.gw, setup.owner.code)).toHaveLength(1)
    const drops = listenerAudit(setup.store, setup.teamId).filter((row) => row.action === "dropped")
    expect(drops.map((row) => row.detail)).toEqual(["replay"])
    expect(drops[0]?.entry_id).toBe("delivery-1")
  })

  test("unsigned and bad-signature deliveries are refused and audited", async () => {
    const setup = intakeSetup()
    await pushEnabledListener(setup)
    const raw = JSON.stringify(githubFailurePayload())
    const bad = await deliver(setup.gw, setup.teamId, {
      raw,
      secret: "the-wrong-secret",
      deliveryId: "delivery-bad",
      event: "workflow_run",
    })
    expect(bad.status).toBe(401)
    const unsigned = await deliver(setup.gw, setup.teamId, {
      raw,
      signature: null,
      deliveryId: "delivery-unsigned",
      event: "workflow_run",
    })
    expect(unsigned.status).toBe(401)
    expect(await queue(setup.gw, setup.owner.code)).toHaveLength(0)
    const drops = listenerAudit(setup.store, setup.teamId).filter((row) => row.action === "dropped")
    expect(drops.map((row) => row.detail)).toEqual(["bad_signature", "bad_signature"])
  })

  test("unmatched events create nothing and audit as no_match", async () => {
    const setup = intakeSetup()
    await pushEnabledListener(setup)
    const success = JSON.stringify(
      githubFailurePayload({
        workflow_run: { name: "CI", head_branch: "main", conclusion: "success", html_url: "u" },
      }),
    )
    const res = await deliver(setup.gw, setup.teamId, {
      raw: success,
      secret: setup.secret,
      deliveryId: "delivery-success",
      event: "workflow_run",
    })
    expect(res.status).toBe(200)
    expect(res.json.queued).toBe(0)
    const wrongBranch = JSON.stringify(
      githubFailurePayload({
        workflow_run: { name: "CI", head_branch: "dev", conclusion: "failure", html_url: "u" },
      }),
    )
    const res2 = await deliver(setup.gw, setup.teamId, {
      raw: wrongBranch,
      secret: setup.secret,
      deliveryId: "delivery-dev",
      event: "workflow_run",
    })
    expect(res2.json.queued).toBe(0)
    expect(await queue(setup.gw, setup.owner.code)).toHaveLength(0)
    const drops = listenerAudit(setup.store, setup.teamId).filter((row) => row.action === "dropped")
    expect(drops.map((row) => row.detail)).toEqual(["no_match", "no_match"])
  })

  test("a matching but disabled listener queues nothing: listener_disabled", async () => {
    const setup = intakeSetup()
    const pushed = await pushObjects(setup.gw, setup.owner.code, [
      listenerObject({ body: JSON.stringify(definition({ enabled: false })) }),
    ])
    expect(pushResults(pushed)).toEqual([{ id: "lis_1", result: "stored" }])
    const res = await deliver(setup.gw, setup.teamId, {
      raw: JSON.stringify(githubFailurePayload()),
      secret: setup.secret,
      deliveryId: "delivery-1",
      event: "workflow_run",
    })
    expect(res.json.queued).toBe(0)
    const drops = listenerAudit(setup.store, setup.teamId).filter((row) => row.action === "dropped")
    expect(drops.map((row) => row.detail)).toEqual(["listener_disabled"])
  })

  test("the generic signed webhook queues for a generic listener", async () => {
    const setup = intakeSetup()
    const genericDef = definition({
      trigger: { source: "generic", event: "ci_failure" },
      filter: { repo: "acme/widgets" },
    })
    const pushed = await pushObjects(setup.gw, setup.owner.code, [
      listenerObject({ id: "lis_g", body: JSON.stringify(genericDef) }),
    ])
    expect(pushResults(pushed)).toEqual([{ id: "lis_g", result: "stored" }])
    const raw = JSON.stringify({
      repo: "acme/widgets",
      kind: "ci_failure",
      workflow: "deploy",
      url: "https://ci.example.com/run/9",
    })
    const res = await deliver(setup.gw, setup.teamId, {
      source: "generic",
      raw,
      secret: setup.secret,
      deliveryId: "gen-1",
    })
    expect(res.status).toBe(200)
    expect(res.json.queued).toBe(1)
    const requests = await queue(setup.gw, setup.owner.code)
    expect(requests[0]?.listener_id).toBe("lis_g")
    expect((requests[0]?.event as Record<string, unknown>).workflow).toBe("deploy")
  })

  test("a team that never configured intake creates nothing; an unknown team 404s", async () => {
    const setup = intakeSetup()
    const other = makeAccount(setup.store, "uid_other")
    const otherTeam = makeTeam(setup.store, other, [])
    const raw = JSON.stringify(githubFailurePayload())
    const res = await deliver(setup.gw, otherTeam, {
      raw,
      secret: "anything",
      deliveryId: "delivery-1",
      event: "workflow_run",
    })
    expect(res.status).toBe(404)
    const drops = listenerAudit(setup.store, otherTeam).filter((row) => row.action === "dropped")
    expect(drops.map((row) => row.detail)).toEqual(["no_webhook_config"])
    expect(setup.store.listListenerRunRequests(otherTeam)).toHaveLength(0)
    const missing = await deliver(setup.gw, "gt_000000000000", {
      raw,
      secret: "anything",
      deliveryId: "delivery-1",
      event: "workflow_run",
    })
    expect(missing.status).toBe(404)
  })

  test("malformed deliveries (bad JSON, missing delivery id) are audited drops", async () => {
    const setup = intakeSetup()
    await pushEnabledListener(setup)
    const badJson = await deliver(setup.gw, setup.teamId, {
      raw: "{not json",
      secret: setup.secret,
      deliveryId: "delivery-bad-json",
      event: "workflow_run",
    })
    expect(badJson.status).toBe(400)
    const noId = await deliver(setup.gw, setup.teamId, {
      raw: JSON.stringify(githubFailurePayload()),
      secret: setup.secret,
      event: "workflow_run",
    })
    expect(noId.status).toBe(400)
    expect(await queue(setup.gw, setup.owner.code)).toHaveLength(0)
    const drops = listenerAudit(setup.store, setup.teamId).filter((row) => row.action === "dropped")
    expect(drops.map((row) => row.detail)).toEqual(["malformed", "malformed"])
  })

  test("the GitHub ping handshake is acknowledged without audit noise", async () => {
    const setup = intakeSetup()
    await pushEnabledListener(setup)
    const before = listenerAudit(setup.store, setup.teamId).length
    const res = await deliver(setup.gw, setup.teamId, {
      raw: JSON.stringify({ zen: "Keep it simple." }),
      secret: setup.secret,
      deliveryId: "ping-1",
      event: "ping",
    })
    expect(res.status).toBe(200)
    expect(res.json.ping).toBe(true)
    expect(listenerAudit(setup.store, setup.teamId)).toHaveLength(before)
  })

  test("a listener whose creator left the team fires nothing", async () => {
    const setup = intakeSetup()
    const authored = await pushObjects(setup.gw, setup.member.code, [
      listenerObject({ id: "lis_member" }),
    ])
    expect(pushResults(authored)).toEqual([{ id: "lis_member", result: "stored" }])
    const left = setup.store.leaveTeam({ uid: setup.member.uid })
    expect(left.ok).toBe(true)
    const res = await deliver(setup.gw, setup.teamId, {
      raw: JSON.stringify(githubFailurePayload()),
      secret: setup.secret,
      deliveryId: "delivery-1",
      event: "workflow_run",
    })
    expect(res.json.queued).toBe(0)
    const drops = listenerAudit(setup.store, setup.teamId).filter((row) => row.action === "dropped")
    expect(drops.map((row) => row.detail)).toEqual(["creator_not_member"])
  })

  test("intake is tenancy-scoped: another team's listeners never fire", async () => {
    const setup = intakeSetup()
    await pushEnabledListener(setup)
    const other = makeAccount(setup.store, "uid_other")
    const otherTeam = makeTeam(setup.store, other, [])
    const otherSecret = setup.store.ensureTeamWebhookSecret(otherTeam).secret
    const res = await deliver(setup.gw, otherTeam, {
      raw: JSON.stringify(githubFailurePayload()),
      secret: otherSecret,
      deliveryId: "delivery-1",
      event: "workflow_run",
    })
    expect(res.json.queued).toBe(0)
    expect(setup.store.listListenerRunRequests(otherTeam)).toHaveLength(0)
    expect(setup.store.listListenerRunRequests(setup.teamId)).toHaveLength(0)
  })
})

describe("queue expiry (next-block spec §6.1)", () => {
  test("queued requests expire on TTL with an audit row and a creator notification", async () => {
    const setup = intakeSetup()
    await pushEnabledListener(setup)
    const res = await deliver(setup.gw, setup.teamId, {
      raw: JSON.stringify(githubFailurePayload()),
      secret: setup.secret,
      deliveryId: "delivery-1",
      event: "workflow_run",
    })
    expect(res.json.queued).toBe(1)
    const future = Date.now() + 73 * 3_600_000
    const sweep = runListenerExpirySweep(setup.store, { now: future })
    expect(sweep.expired).toBe(1)
    const requests = await queue(setup.gw, setup.owner.code)
    expect(requests[0]?.state).toBe("expired")
    const expired = listenerAudit(setup.store, setup.teamId).filter(
      (row) => row.action === "expired",
    )
    expect(expired).toHaveLength(1)
    expect(expired[0]?.entry_id).toBe((res.json.request_ids as string[])[0])
    const notes = setup.store
      .listNotifications(setup.owner.uid)
      .map((row) => row.type)
    expect(notes).toContain("listener_request_expired")
    // Idempotent: a second sweep at the same instant expires nothing.
    expect(runListenerExpirySweep(setup.store, { now: future }).expired).toBe(0)
  })
})

describe("team listener admin endpoints", () => {
  const USERS: Record<string, { localId: string; email: string }> = {
    tok_a: { localId: "uid_a", email: "a@example.com" },
    tok_b: { localId: "uid_b", email: "b@example.com" },
  }

  beforeAll(() => {
    process.env.FIREBASE_API_KEY = "key"
    process.env.FIREBASE_AUTH_DOMAIN = "grist-test.firebaseapp.com"
    process.env.FIREBASE_PROJECT_ID = "grist-test"
    process.env.FIREBASE_APP_ID = "1:1:web:abc"
  })

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
    fetchImpl: Gateway["fetch"],
    path: string,
    body: Record<string, unknown>,
  ): Promise<CallResult> {
    const response = await fetchImpl(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
    return { status: response.status, json: (await response.json()) as Record<string, unknown> }
  }

  async function teamWithMember(fetchImpl: Gateway["fetch"]) {
    const sessionB = await call(fetchImpl, "/v1/auth/session", { id_token: "tok_b" })
    await call(fetchImpl, "/v1/teams", { id_token: "tok_a", name: "Admins" })
    await call(fetchImpl, "/v1/teams/members", {
      id_token: "tok_a",
      user_id: sessionB.json.user_id as string,
    })
  }

  test("the ceiling is owner-set, member-readable, and shape-checked", async () => {
    const gw = gateway()
    await teamWithMember(gw.fetch)
    const unset = await call(gw.fetch, "/v1/teams/listener-ceiling", { id_token: "tok_b" })
    expect(unset.json.ceiling).toBeNull()
    const byMember = await call(gw.fetch, "/v1/teams/listener-ceiling", {
      id_token: "tok_b",
      ceiling: CEILING,
    })
    expect(byMember.status).toBe(403)
    const malformed = await call(gw.fetch, "/v1/teams/listener-ceiling", {
      id_token: "tok_a",
      ceiling: { max_runs_per_day: 0 },
    })
    expect(malformed.status).toBe(400)
    const set = await call(gw.fetch, "/v1/teams/listener-ceiling", {
      id_token: "tok_a",
      ceiling: CEILING,
    })
    expect(set.status).toBe(200)
    expect(set.json.ceiling).toEqual(CEILING)
    const read = await call(gw.fetch, "/v1/teams/listener-ceiling", { id_token: "tok_b" })
    expect(read.json.ceiling).toEqual(CEILING)
  })

  test("webhook setup is owner/admin only; the secret is stable until rotated", async () => {
    const gw = gateway()
    await teamWithMember(gw.fetch)
    const byMember = await call(gw.fetch, "/v1/teams/webhooks", { id_token: "tok_b" })
    expect(byMember.status).toBe(403)
    const first = await call(gw.fetch, "/v1/teams/webhooks", { id_token: "tok_a" })
    expect(first.status).toBe(200)
    expect(first.json.created).toBe(true)
    expect(typeof first.json.secret).toBe("string")
    expect(first.json.github_path).toBe(`/v1/webhooks/github/${first.json.team_id as string}`)
    const second = await call(gw.fetch, "/v1/teams/webhooks", { id_token: "tok_a" })
    expect(second.json.created).toBe(false)
    expect(second.json.secret).toBe(first.json.secret)
    const rotated = await call(gw.fetch, "/v1/teams/webhooks/rotate", { id_token: "tok_a" })
    expect(rotated.json.secret).not.toBe(first.json.secret)
  })
})

describe("audit detail migration", () => {
  test("a pre-detail database gains the column; old rows read detail null", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grist-lis-migration-"))
    const file = path.join(dir, "gateway.db")
    try {
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
      expect(legacy[0]?.detail).toBeNull()
      store.appendTeamAudit({
        teamId: "gt_legacy",
        kind: "listener",
        actorUid: "webhook",
        action: "dropped",
        entryId: "delivery-9",
        detail: "bad_signature",
      })
      const trail = store.teamMemoryAudit("gt_legacy")
      expect(trail[1]?.detail).toBe("bad_signature")
      expect(trail[1]?.kind).toBe("listener")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
