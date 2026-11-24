import { describe, expect, test } from "bun:test"
import { formatTeamObjectsStatus, teamObjectsStatusJson } from "./shared"

function status(
  overrides?: Partial<Parameters<typeof formatTeamObjectsStatus>[0]>,
): Parameters<typeof formatTeamObjectsStatus>[0] {
  return {
    enabled: true,
    revoked: false,
    cursor: 4,
    materialized: [
      {
        kind: "skill",
        container: "repo-x",
        name: "deploy-check",
        id: "obj_1",
        seq: 2,
        hash: "abc123",
        path: ".grist/team/skill/deploy-check/SKILL.md",
        authorUserId: "gu_teammate1",
      },
    ],
    pendingCount: 1,
    pushedCount: 3,
    rejectedCount: 0,
    teamRoot: "/repo/.grist/team",
    globalRoot: "/repo/.grist/team-global",
    ...overrides,
  }
}

describe("team-objects status rendering", () => {
  test("off state points at the shared opt-in command", () => {
    const text = formatTeamObjectsStatus(status({ enabled: false }), "/repo")
    expect(text).toContain("sync: off for /repo")
    expect(text).toContain("grist team-memory enable")
  })

  test("on state lists materialized objects, queue, and cursor without bodies", () => {
    const text = formatTeamObjectsStatus(status({ lastError: "network down" }), "/repo")
    expect(text).toContain("Materialized: 1 team object (cursor 4)")
    expect(text).toContain("skill deploy-check — .grist/team/skill/deploy-check/SKILL.md (by gu_teammate1)")
    expect(text).toContain("Queued to push: 1 · pushed: 3 · rejected: 0")
    expect(text).toContain("Last sync error: network down")
  })

  test("revoked state explains the pause", () => {
    const text = formatTeamObjectsStatus(status({ revoked: true }), "/repo")
    expect(text).toContain("Paused: the gateway reports no team")
  })

  test("json shape is stable and machine-readable", () => {
    const json = teamObjectsStatusJson(status({ lastPullAt: 1_700_000_000_000 }), "/repo")
    expect(json).toMatchObject({
      enabled: true,
      directory: "/repo",
      cursor: 4,
      pending_pushes: 1,
      pushed: 3,
      materialized: [{ kind: "skill", name: "deploy-check", id: "obj_1", author_user_id: "gu_teammate1" }],
      last_pull_at: "2023-11-14T22:13:20.000Z",
    })
  })
})
