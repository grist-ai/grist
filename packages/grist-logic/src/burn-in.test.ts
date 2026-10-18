import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import path from "node:path"
import { burnInPath } from "./burn-in.js"

describe("burnInPath (R3: stable joinable default)", () => {
  test("defaults to ~/.grist/burn-in.jsonl regardless of process cwd", () => {
    delete process.env.GRIST_BURNIN_PATH
    expect(burnInPath()).toBe(path.join(homedir(), ".grist", "burn-in.jsonl"))
  })

  test("explicit cwd keeps the per-repo layout", () => {
    delete process.env.GRIST_BURNIN_PATH
    expect(burnInPath("/repo")).toBe("/repo/.grist/burn-in.jsonl")
  })

  test("GRIST_BURNIN_PATH overrides everything", () => {
    process.env.GRIST_BURNIN_PATH = "/tmp/custom.jsonl"
    expect(burnInPath()).toBe("/tmp/custom.jsonl")
    expect(burnInPath("/repo")).toBe("/tmp/custom.jsonl")
    delete process.env.GRIST_BURNIN_PATH
  })
})
