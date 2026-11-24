import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { saveTeamSyncState, type TeamSyncState } from "@grist-ai/logic"
import { formatTeamMemoryStatus, teamMemoryStatusJson } from "./shared"
import { checkTeamMemory } from "../doctor"

function status(overrides?: Partial<Parameters<typeof formatTeamMemoryStatus>[0]>): Parameters<typeof formatTeamMemoryStatus>[0] {
  return {
    enabled: true,
    revoked: false,
    mirrorCount: 3,
    pendingCount: 1,
    pushedCount: 5,
    rejectedCount: 0,
    cursor: 9,
    path: "/repo/.grist/team-memory.json",
    ...overrides,
  }
}

describe("team-memory status rendering", () => {
  test("off state points at the opt-in command", () => {
    const text = formatTeamMemoryStatus(status({ enabled: false }), "/repo")
    expect(text).toContain("sync: off for /repo")
    expect(text).toContain("grist team-memory enable")
  })

  test("on state reports mirror, queue, and cursor without entry bodies", () => {
    const text = formatTeamMemoryStatus(status({ lastError: "network down" }), "/repo")
    expect(text).toContain("Mirror: 3 team entries (cursor 9)")
    expect(text).toContain("Queued to push: 1 · pushed: 5 · rejected: 0")
    expect(text).toContain("Last sync error: network down")
  })

  test("revoked state explains the pause and the remedy", () => {
    const text = formatTeamMemoryStatus(status({ revoked: true }), "/repo")
    expect(text).toContain("Paused: the gateway reports no team")
  })

  test("json shape is stable and machine-readable", () => {
    const json = teamMemoryStatusJson(status({ lastPullAt: 1_700_000_000_000 }), "/repo")
    expect(json).toMatchObject({
      enabled: true,
      directory: "/repo",
      mirror_entries: 3,
      pending_pushes: 1,
      cursor: 9,
      last_pull_at: "2023-11-14T22:13:20.000Z",
    })
  })
})

describe("doctor team memory check", () => {
  test("a repo that never opted in passes with the opt-in hint", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grist-doctor-tm-"))
    const result = checkTeamMemory(cwd)
    expect(result.status).toBe("pass")
    expect(result.detail).toContain("not enabled for this repo")
  })

  test("an opted-in repo with a sync error warns with counts", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grist-doctor-tm-"))
    const state: TeamSyncState = {
      version: 1,
      enabled: true,
      revoked: false,
      cursor: 4,
      mirror: [],
      pending: [],
      pushed: {},
      rejected: {},
      lastError: "gateway pull failed: HTTP 500",
      objects: { cursor: 0, pending: [], pushed: {}, rejected: {}, pushedHeads: {}, manifest: {} },
    }
    await saveTeamSyncState(cwd, state)
    const result = checkTeamMemory(cwd)
    expect(result.status).toBe("warn")
    expect(result.detail).toContain("cursor 4")
    expect(result.detail).toContain("HTTP 500")
  })
})
