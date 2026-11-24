import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { InviteConfig } from "../invite-config.js"
import {
  buildAgentDefinitionObject,
  buildArtifactObject,
  buildSkillObject,
  flushTeamObjectPushes,
  hashTeamObjectContent,
  publishTeamObject,
  pullTeamObjects,
  queueTeamObjectPush,
  renderAgentDefinitionFile,
  renderSkillFile,
  renderTeamObjectFile,
  syncTeamObjects,
  TEAM_GLOBAL_CONTAINER,
  teamObjectChainKey,
  teamObjectPath,
  validateTeamObject,
  type TeamObjectDeps,
} from "./team-objects.js"
import {
  loadTeamSyncState,
  saveTeamSyncState,
  setTeamMemoryEnabled,
  teamSyncPath,
  type TeamObjectWire,
} from "./team-sync.js"

const CONFIG: InviteConfig = { code: "invite-code-1", gatewayUrl: "http://gateway.test", kind: "invite" }

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "grist-team-objects-"))
}

function skill(overrides?: Partial<TeamObjectWire>): TeamObjectWire {
  return {
    id: "obj_1",
    kind: "skill",
    container: "repo-x",
    name: "deploy-check",
    body: "---\nname: deploy-check\ndescription: Pre-deploy verification\n---\nRun the smoke suite.",
    metadata: {},
    supersedes: null,
    ...overrides,
  }
}

function agentDef(overrides?: Partial<TeamObjectWire>): TeamObjectWire {
  return {
    id: "def_1",
    kind: "agent_definition",
    container: "repo-x",
    name: "reviewer",
    body: "You review diffs for correctness.",
    metadata: { tools: ["read", "grep"], rung_ceiling: "medium" },
    supersedes: null,
    ...overrides,
  }
}

type PushRow = { id: string | null; result: string; reason?: string }
type ServedObject = Record<string, unknown>

/**
 * In-memory stub of the gateway's team-object endpoints (filesystem
 * spec v1 §6 wire shapes, as shipped in S-FS1). Pull serves the
 * test-arranged heads/tombstones; push records every call so gating
 * and supersedes wiring can be asserted exactly.
 */
function stubGateway(options?: {
  onPush?: (objects: TeamObjectWire[]) => PushRow[]
  heads?: ServedObject[]
  tombstones?: { id: string; seq: number }[]
  nextSeq?: number
  revoked?: boolean
  failPush?: boolean
  failPull?: boolean
  pushStatus?: number
}) {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    calls.push({ path: url, body })
    if (url.endsWith("/v1/team-objects/push")) {
      if (options?.failPush) throw new Error("network down")
      if (options?.pushStatus) return new Response("nope", { status: options.pushStatus })
      const objects = body.objects as TeamObjectWire[]
      const results: PushRow[] =
        options?.onPush?.(objects) ?? objects.map((object) => ({ id: object.id, result: "stored" }))
      return Response.json({ results })
    }
    if (url.endsWith("/v1/team-objects/pull")) {
      if (options?.failPull) throw new Error("network down")
      if (options?.revoked) return Response.json({ revoked: true, objects: [], tombstones: [], next_seq: 0 })
      const sinceSeq = typeof body.since_seq === "number" ? body.since_seq : 0
      const containers = Array.isArray(body.containers) ? (body.containers as string[]) : undefined
      const objects = (options?.heads ?? []).filter(
        (object) =>
          (object.seq as number) > sinceSeq &&
          (!containers || containers.includes(object.container as string)),
      )
      const tombstones = (options?.tombstones ?? [])
        .filter((row) => row.seq > sinceSeq)
        .map((row) => row.id)
      return Response.json({ objects, tombstones, next_seq: options?.nextSeq ?? sinceSeq })
    }
    return new Response("not found", { status: 404 })
  }
  const deps: TeamObjectDeps = {
    fetch: fetchStub as typeof fetch,
    loadConfig: () => CONFIG,
    container: "repo-x",
  }
  return { calls, deps }
}

function served(overrides?: Record<string, unknown>): ServedObject {
  return {
    id: "obj_1",
    kind: "skill",
    container: "repo-x",
    name: "deploy-check",
    body: "---\nname: deploy-check\ndescription: Pre-deploy verification\n---\nRun the smoke suite.",
    metadata: {},
    supersedes: null,
    author_user_id: "gu_teammate1",
    status: "active",
    seq: 1,
    is_head: true,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  }
}

describe("objects journal (filesystem spec v1 §6)", () => {
  test("a pre-filesystem state file gains a default objects journal; memory fields untouched", async () => {
    const cwd = tempRepo()
    fs.mkdirSync(path.dirname(teamSyncPath(cwd)), { recursive: true })
    fs.writeFileSync(
      teamSyncPath(cwd),
      JSON.stringify({
        version: 1,
        enabled: true,
        revoked: false,
        cursor: 7,
        mirror: [],
        pending: [],
        pushed: {},
        rejected: {},
      }),
    )
    const state = await loadTeamSyncState(cwd)
    expect(state.cursor).toBe(7)
    expect(state.objects).toEqual({
      cursor: 0,
      pending: [],
      pushed: {},
      rejected: {},
      pushedHeads: {},
      manifest: {},
    })
  })

  test("the two cursors never move each other", async () => {
    const cwd = tempRepo()
    const state = await loadTeamSyncState(cwd)
    state.enabled = true
    state.cursor = 7
    await saveTeamSyncState(cwd, state)

    const gw = stubGateway({ heads: [served()], nextSeq: 3 })
    const pull = await pullTeamObjects(cwd, gw.deps)
    expect(pull.cursor).toBe(3)

    const after = await loadTeamSyncState(cwd)
    expect(after.cursor).toBe(7) // memory cursor untouched by the object stream
    expect(after.objects.cursor).toBe(3)
  })

  test("no opt-in → publish is disabled, zero calls, nothing written", async () => {
    const cwd = tempRepo()
    const gw = stubGateway()
    const { queue, push } = await publishTeamObject(cwd, skill(), gw.deps)
    expect(queue).toBe("disabled")
    expect(push.attempted).toBe(0)
    expect(gw.calls).toHaveLength(0)
    expect(fs.existsSync(path.join(cwd, ".grist", "team"))).toBe(false)
    const pull = await pullTeamObjects(cwd, gw.deps)
    expect(pull.pulled).toBe(0)
    expect(gw.calls).toHaveLength(0)
  })
})

describe("local admission mirrors the gateway", () => {
  test("validateTeamObject returns the gateway's reasons", () => {
    expect(validateTeamObject(skill())).toBeUndefined()
    expect(validateTeamObject(agentDef())).toBeUndefined()
    expect(validateTeamObject(skill({ name: "Deploy Check" }))).toBe("invalid_name")
    expect(validateTeamObject(skill({ body: "x".repeat(32 * 1024 + 1) }))).toBe("oversize")
    expect(validateTeamObject(skill({ body: "no frontmatter, no description" }))).toBe("invalid_schema")
    expect(validateTeamObject(skill({ body: "---\nname: other\ndescription: d\n---\nBody." }))).toBe(
      "invalid_schema",
    )
    expect(validateTeamObject(agentDef({ metadata: { tools: "read" } }))).toBe("invalid_schema")
    expect(validateTeamObject(agentDef({ metadata: { rung_ceiling: "ultra" } }))).toBe("invalid_schema")
    expect(validateTeamObject(skill({ body: "key: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789" }))).toBe(
      "secret_detected",
    )
  })

  test("an invalid or secret-bearing publish is rejected locally and never sent", async () => {
    const cwd = tempRepo()
    const gw = stubGateway()
    await setTeamMemoryEnabled(cwd, true)
    const bad = await publishTeamObject(cwd, skill({ id: "obj_bad", name: "Bad Name" }), gw.deps)
    expect(bad.queue).toBe("rejected")
    const secret = await publishTeamObject(
      cwd,
      skill({ id: "obj_secret", body: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789 in the body" }),
      gw.deps,
    )
    expect(secret.queue).toBe("rejected")
    const state = await loadTeamSyncState(cwd)
    expect(state.objects.rejected.obj_bad?.reason).toBe("invalid_name")
    expect(state.objects.rejected.obj_secret?.reason).toBe("secret_detected")
    expect(gw.calls).toHaveLength(0)
  })
})

describe("publish → push wiring", () => {
  test("stored results update the journal; an edit push supersedes the last head", async () => {
    const cwd = tempRepo()
    const gw = stubGateway()
    await setTeamMemoryEnabled(cwd, true)

    const first = await publishTeamObject(cwd, skill(), gw.deps)
    expect(first.queue).toBe("queued")
    expect(first.push).toMatchObject({ attempted: 1, stored: 1, pending: 0 })

    const edit = await publishTeamObject(
      cwd,
      skill({ id: "obj_2", body: "---\nname: deploy-check\ndescription: Pre-deploy verification\n---\nv2 body." }),
      gw.deps,
    )
    expect(edit.push.stored).toBe(1)

    const pushes = gw.calls.filter((call) => call.path.endsWith("/v1/team-objects/push"))
    expect(pushes).toHaveLength(2)
    const second = (pushes[1]?.body.objects as TeamObjectWire[])[0]
    expect(second?.id).toBe("obj_2")
    expect(second?.supersedes).toBe("obj_1")

    const state = await loadTeamSyncState(cwd)
    const key = teamObjectChainKey("skill", "repo-x", "deploy-check")
    expect(state.objects.pushedHeads[key]).toBe("obj_2")
    expect(Object.keys(state.objects.pushed).sort()).toEqual(["obj_1", "obj_2"])
  })

  test("gateway rejections are terminal; offline pushes stay pending", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const rejecting = stubGateway({
      onPush: (objects) => objects.map((object) => ({ id: object.id, result: "rejected", reason: "name_taken" })),
    })
    const refused = await publishTeamObject(cwd, skill(), rejecting.deps)
    expect(refused.push.rejected).toBe(1)
    expect((await loadTeamSyncState(cwd)).objects.rejected.obj_1?.reason).toBe("name_taken")
    expect(await queueTeamObjectPush(cwd, skill(), rejecting.deps)).toBe("duplicate")

    const down = stubGateway({ failPush: true })
    await queueTeamObjectPush(cwd, agentDef(), down.deps)
    const failed = await flushTeamObjectPushes(cwd, down.deps)
    expect(failed.error).toContain("network down")
    expect(failed.pending).toBe(1)
    const up = stubGateway()
    const landed = await flushTeamObjectPushes(cwd, up.deps)
    expect(landed).toMatchObject({ stored: 1, pending: 0 })
  })

  test("a 409 on push revokes: materialized files wiped, pause set", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const gw = stubGateway({ heads: [served()], nextSeq: 1 })
    await pullTeamObjects(cwd, gw.deps)
    const file = path.join(cwd, ".grist", "team", "skill", "deploy-check", "SKILL.md")
    expect(fs.existsSync(file)).toBe(true)

    const gone = stubGateway({ pushStatus: 409 })
    await queueTeamObjectPush(cwd, agentDef(), gone.deps)
    const summary = await flushTeamObjectPushes(cwd, gone.deps)
    expect(summary.error).toBe("not in a team")
    const state = await loadTeamSyncState(cwd)
    expect(state.revoked).toBe(true)
    expect(state.objects.manifest).toEqual({})
    expect(fs.existsSync(path.join(cwd, ".grist", "team"))).toBe(false)
  })
})

describe("pull → materialize", () => {
  test("heads land as files; the manifest records id, hash, and repo-relative path", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const gw = stubGateway({
      heads: [
        served(),
        served({
          id: "def_1",
          kind: "agent_definition",
          name: "reviewer",
          body: "You review diffs for correctness.",
          metadata: { tools: ["read", "grep"], rung_ceiling: "medium" },
          seq: 2,
        }),
      ],
      nextSeq: 2,
    })
    const pull = await pullTeamObjects(cwd, gw.deps)
    expect(pull).toMatchObject({ pulled: 2, tombstoned: 0, cursor: 2 })

    const skillFile = path.join(cwd, ".grist", "team", "skill", "deploy-check", "SKILL.md")
    const defFile = path.join(cwd, ".grist", "team", "agent_definition", "reviewer.md")
    expect(fs.readFileSync(skillFile, "utf-8")).toContain("Run the smoke suite.")
    const defContent = fs.readFileSync(defFile, "utf-8")
    expect(defContent).toContain("You review diffs for correctness.")
    expect(defContent).toContain("mode: subagent")
    expect(defContent).toContain('tools: ["read", "grep"]')
    expect(defContent).toContain('rung_ceiling: "medium"')

    const state = await loadTeamSyncState(cwd)
    const skillEntry = state.objects.manifest[teamObjectChainKey("skill", "repo-x", "deploy-check")]
    expect(skillEntry?.id).toBe("obj_1")
    expect(skillEntry?.authorUserId).toBe("gu_teammate1")
    expect(skillEntry?.path).toBe(path.join(".grist", "team", "skill", "deploy-check", "SKILL.md"))
    expect(skillEntry?.hash).toBe(hashTeamObjectContent(fs.readFileSync(skillFile, "utf-8")))
    // The manifest never carries bodies.
    expect(JSON.stringify(state.objects.manifest)).not.toContain("smoke suite")
  })

  test("a skill without frontmatter is materialized with synthesized frontmatter", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const gw = stubGateway({
      heads: [
        served({
          body: "Just instructions, no frontmatter.",
          metadata: { description: "Plain skill" },
        }),
      ],
      nextSeq: 1,
    })
    await pullTeamObjects(cwd, gw.deps)
    const file = path.join(cwd, ".grist", "team", "skill", "deploy-check", "SKILL.md")
    const content = fs.readFileSync(file, "utf-8")
    expect(content.startsWith("---")).toBe(true)
    expect(content).toContain('name: "deploy-check"')
    expect(content).toContain('description: "Plain skill"')
    expect(content).toContain("Just instructions, no frontmatter.")
  })

  test("an edit arrives as the new head and replaces the materialized file", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const v1 = stubGateway({ heads: [served()], nextSeq: 1 })
    await pullTeamObjects(cwd, v1.deps)
    const file = path.join(cwd, ".grist", "team", "skill", "deploy-check", "SKILL.md")
    expect(fs.readFileSync(file, "utf-8")).toContain("Run the smoke suite.")

    const v2 = stubGateway({
      heads: [
        served({
          id: "obj_2",
          body: "---\nname: deploy-check\ndescription: Pre-deploy verification\n---\nv2: also check the queue depth.",
          supersedes: "obj_1",
          seq: 2,
        }),
      ],
      nextSeq: 2,
    })
    const pull = await pullTeamObjects(cwd, v2.deps)
    expect(pull.pulled).toBe(1)
    expect(fs.readFileSync(file, "utf-8")).toContain("also check the queue depth")
    const state = await loadTeamSyncState(cwd)
    expect(state.objects.manifest[teamObjectChainKey("skill", "repo-x", "deploy-check")]?.id).toBe("obj_2")
  })

  test("a tombstone deletes the materialized file and its manifest entry", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const gw = stubGateway({ heads: [served()], nextSeq: 1 })
    await pullTeamObjects(cwd, gw.deps)
    const file = path.join(cwd, ".grist", "team", "skill", "deploy-check", "SKILL.md")
    expect(fs.existsSync(file)).toBe(true)

    const after = stubGateway({ tombstones: [{ id: "obj_1", seq: 2 }], nextSeq: 2 })
    const pull = await pullTeamObjects(cwd, after.deps)
    expect(pull.tombstoned).toBe(1)
    expect(fs.existsSync(file)).toBe(false)
    expect((await loadTeamSyncState(cwd)).objects.manifest).toEqual({})
  })

  test("team-global objects materialize under the sibling root; the pull asks for both containers", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const gw = stubGateway({
      heads: [served({ container: TEAM_GLOBAL_CONTAINER, name: "house-style" })],
      nextSeq: 1,
    })
    await pullTeamObjects(cwd, gw.deps)
    const pullCall = gw.calls.find((call) => call.path.endsWith("/v1/team-objects/pull"))
    expect(pullCall?.body.containers).toEqual(["repo-x", TEAM_GLOBAL_CONTAINER])
    const file = path.join(cwd, ".grist", "team-global", "skill", "house-style", "SKILL.md")
    expect(fs.existsSync(file)).toBe(true)
  })

  test("revoked wipes the materialized mirror and pauses; a pre-set revoked flag wipes without network", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const gw = stubGateway({ heads: [served()], nextSeq: 1 })
    await pullTeamObjects(cwd, gw.deps)
    expect(fs.existsSync(path.join(cwd, ".grist", "team"))).toBe(true)

    const revokedGw = stubGateway({ revoked: true })
    const pull = await pullTeamObjects(cwd, revokedGw.deps)
    expect(pull.revoked).toBe(true)
    expect(fs.existsSync(path.join(cwd, ".grist", "team"))).toBe(false)
    const state = await loadTeamSyncState(cwd)
    expect(state.objects.manifest).toEqual({})
    expect(state.objects.cursor).toBe(0)

    // Simulate the memory stream recording revocation first: the next
    // object pull performs the local wipe with zero network calls.
    const cwd2 = tempRepo()
    await setTeamMemoryEnabled(cwd2, true)
    const gw2 = stubGateway({ heads: [served()], nextSeq: 1 })
    await pullTeamObjects(cwd2, gw2.deps)
    const flagged = await loadTeamSyncState(cwd2)
    flagged.revoked = true
    await saveTeamSyncState(cwd2, flagged)
    const silent = stubGateway()
    const again = await pullTeamObjects(cwd2, silent.deps)
    expect(again.revoked).toBe(true)
    expect(silent.calls).toHaveLength(0)
    expect(fs.existsSync(path.join(cwd2, ".grist", "team"))).toBe(false)
  })

  test("a failed materialization does not advance the cursor; the retry converges", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const gw = stubGateway({ heads: [served()], nextSeq: 5 })
    const failing: TeamObjectDeps = {
      ...gw.deps,
      writeFile: async () => {
        throw new Error("disk full")
      },
    }
    const failed = await pullTeamObjects(cwd, failing)
    expect(failed.error).toContain("disk full")
    expect((await loadTeamSyncState(cwd)).objects.cursor).toBe(0)

    const retried = await pullTeamObjects(cwd, gw.deps)
    expect(retried).toMatchObject({ pulled: 1, cursor: 5 })
    const file = path.join(cwd, ".grist", "team", "skill", "deploy-check", "SKILL.md")
    expect(fs.existsSync(file)).toBe(true)
  })

  test("syncTeamObjects flushes then pulls in one call", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const gw = stubGateway({ heads: [served({ id: "obj_remote", name: "remote-skill" })], nextSeq: 1 })
    await queueTeamObjectPush(cwd, skill(), gw.deps)
    const { push, pull } = await syncTeamObjects(cwd, gw.deps)
    expect(push.stored).toBe(1)
    expect(pull.pulled).toBe(1)
    expect(gw.calls.map((call) => call.path.split("/").pop())).toEqual(["push", "pull"])
  })
})

describe("local authoring parse + render", () => {
  test("buildSkillObject takes the name from frontmatter, else the fallback", () => {
    const fromFrontmatter = buildSkillObject({
      content: "---\nname: deploy-check\ndescription: d\n---\nBody.",
      fallbackName: "ignored",
      container: "repo-x",
      id: "obj_1",
    })
    expect(fromFrontmatter.name).toBe("deploy-check")
    expect(fromFrontmatter.body).toContain("Body.")
    const fromFile = buildSkillObject({
      content: "Plain body.",
      fallbackName: "plain-skill",
      container: "repo-x",
      id: "obj_2",
      description: "From the flag",
    })
    expect(fromFile.name).toBe("plain-skill")
    expect(fromFile.metadata).toEqual({ description: "From the flag" })
  })

  test("buildAgentDefinitionObject strips frontmatter into metadata", () => {
    const object = buildAgentDefinitionObject({
      content: [
        "---",
        "description: Reviews diffs",
        'tools: ["read", "grep"]',
        "rung_ceiling: medium",
        "---",
        "You review diffs.",
      ].join("\n"),
      fallbackName: "reviewer",
      container: "repo-x",
      id: "def_1",
    })
    expect(object.body).toBe("You review diffs.")
    expect(object.metadata).toEqual({
      description: "Reviews diffs",
      tools: ["read", "grep"],
      rung_ceiling: "medium",
    })

    const blockList = buildAgentDefinitionObject({
      content: "---\ntools:\n  - read\n  - edit\n---\nPrompt.",
      fallbackName: "editor",
      container: "repo-x",
      id: "def_2",
    })
    expect(blockList.metadata.tools).toEqual(["read", "edit"])
  })

  test("renderers produce loader-shaped files", () => {
    const skillFile = renderSkillFile({ name: "x", body: "Body only.", metadata: { description: "d" } })
    expect(skillFile).toContain('name: "x"')
    expect(skillFile).toContain("Body only.")
    const verbatim = renderSkillFile({
      name: "x",
      body: "---\nname: x\ndescription: d\n---\nBody.",
      metadata: {},
    })
    expect(verbatim).toBe("---\nname: x\ndescription: d\n---\nBody.")
    const def = renderAgentDefinitionFile({ name: "r", body: "Prompt.", metadata: {} })
    expect(def).toContain("mode: subagent")
    expect(def).toContain("Prompt.")
  })
})

describe("artifacts (filesystem spec v1 §5, S-FS3)", () => {
  function artifact(overrides?: Partial<TeamObjectWire>): TeamObjectWire {
    return {
      id: "art_1",
      kind: "artifact",
      container: "repo-x",
      name: "fix-diff",
      body: "diff --git a/src/a.ts b/src/a.ts\n-old line\n+new line\n",
      metadata: { session_id: "sess_1" },
      supersedes: null,
      ...overrides,
    }
  }

  test("buildArtifactObject carries provenance in metadata, body verbatim", () => {
    const object = buildArtifactObject({
      content: "the diff",
      name: "fix-diff",
      container: "repo-x",
      id: "art_1",
      memoryEntryId: "mem_1",
      sessionId: "sess_1",
    })
    expect(object.kind).toBe("artifact")
    expect(object.body).toBe("the diff")
    expect(object.metadata).toEqual({ memory_entry_id: "mem_1", session_id: "sess_1" })
    expect(object.supersedes).toBeNull()
  })

  test("local admission mirrors the gateway's artifact reasons", () => {
    expect(validateTeamObject(artifact())).toBeUndefined()
    expect(validateTeamObject(artifact({ metadata: { memory_entry_id: "mem_1" } }))).toBeUndefined()
    expect(validateTeamObject(artifact({ metadata: {} }))).toBe("missing_provenance")
    expect(validateTeamObject(artifact({ metadata: { session_id: "" } }))).toBe("missing_provenance")
    expect(validateTeamObject(artifact({ metadata: { memory_entry_id: 42 } }))).toBe("missing_provenance")
    expect(validateTeamObject(artifact({ body: "bytes \u0003\u0004 here" }))).toBe("not_text")
    // The artifact cap is 64 KB, not the 32 KB document cap.
    expect(validateTeamObject(artifact({ body: "x".repeat(40 * 1024) }))).toBeUndefined()
    expect(validateTeamObject(artifact({ body: "x".repeat(64 * 1024 + 1) }))).toBe("oversize")
  })

  test("an artifact without provenance is held locally and never sent", async () => {
    const cwd = tempRepo()
    const gw = stubGateway()
    await setTeamMemoryEnabled(cwd, true)
    const held = await publishTeamObject(cwd, artifact({ metadata: {} }), gw.deps)
    expect(held.queue).toBe("rejected")
    const state = await loadTeamSyncState(cwd)
    expect(state.objects.rejected.art_1?.reason).toBe("missing_provenance")
    expect(gw.calls).toHaveLength(0)
  })

  test("a pulled artifact materializes as a plain verbatim file outside the loadable paths", async () => {
    const cwd = tempRepo()
    await setTeamMemoryEnabled(cwd, true)
    const body = "diff --git a/src/a.ts b/src/a.ts\n-old line\n+new line\n"
    const gw = stubGateway({
      heads: [
        served({
          id: "art_1",
          kind: "artifact",
          name: "fix-diff",
          body,
          metadata: { session_id: "sess_1" },
          seq: 1,
        }),
      ],
      nextSeq: 1,
    })
    const pull = await pullTeamObjects(cwd, gw.deps)
    expect(pull).toMatchObject({ pulled: 1, tombstoned: 0, cursor: 1 })

    const file = path.join(cwd, ".grist", "team", "artifact", "fix-diff")
    // Verbatim: no frontmatter is synthesized around evidence.
    expect(fs.readFileSync(file, "utf-8")).toBe(body)
    // Nothing landed in the areas the skill / agent loaders scan.
    expect(fs.existsSync(path.join(cwd, ".grist", "team", "skill"))).toBe(false)
    expect(fs.existsSync(path.join(cwd, ".grist", "team", "agent_definition"))).toBe(false)

    const state = await loadTeamSyncState(cwd)
    const entry = state.objects.manifest[teamObjectChainKey("artifact", "repo-x", "fix-diff")]
    expect(entry?.kind).toBe("artifact")
    expect(entry?.id).toBe("art_1")
    expect(entry?.path).toBe(path.join(".grist", "team", "artifact", "fix-diff"))
    expect(entry?.hash).toBe(hashTeamObjectContent(body))
  })

  test("artifact paths and rendering stay out of the loaders' shapes", () => {
    const cwd = "/repo"
    expect(teamObjectPath(cwd, "repo", { kind: "artifact", container: "repo", name: "fix-diff" })).toBe(
      path.join(cwd, ".grist", "team", "artifact", "fix-diff"),
    )
    expect(
      renderTeamObjectFile({ kind: "artifact", name: "fix-diff", body: "raw text", metadata: {} }),
    ).toBe("raw text")
  })
})
