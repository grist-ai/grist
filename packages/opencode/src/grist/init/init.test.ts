import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Process } from "@/util/process"
import { parseSince, mineOwnership } from "./ownership"
import { scaffoldGrist } from "./scaffold"
import { bootstrapCodebase } from "./bootstrap"

describe("parseSince", () => {
  test("parses months and days", () => {
    const now = new Date("2026-09-19T00:00:00Z")
    const months = parseSince("18months", now)
    expect(months.getUTCFullYear()).toBe(2025)
    const days = parseSince("30d", now)
    expect(days.toISOString().slice(0, 10)).toBe("2026-08-20")
  })
})

describe("scaffoldGrist", () => {
  test("creates .grist, config, and gitignore", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grist-init-"))
    const first = scaffoldGrist({ cwd: dir })
    expect(first.created).toContain(".grist/")
    expect(first.created).toContain("opencode.jsonc")
    expect(fs.existsSync(path.join(dir, ".grist", "README.md"))).toBe(true)
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain(".grist/")

    const second = scaffoldGrist({ cwd: dir })
    expect(second.created.length).toBe(0)
    expect(second.skipped.length).toBeGreaterThan(0)
  })
})

describe("mineOwnership + bootstrap", () => {
  test("mines ownership in a tiny git repo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grist-boot-"))
    await Process.run(["git", "init"], { cwd: dir })
    await Process.run(["git", "config", "user.email", "grist@test"], { cwd: dir })
    await Process.run(["git", "config", "user.name", "Grist Test"], { cwd: dir })
    fs.writeFileSync(path.join(dir, "hello.txt"), "hi\n")
    await Process.run(["git", "add", "hello.txt"], { cwd: dir })
    await Process.run(["git", "commit", "-m", "init"], { cwd: dir })

    const mined = await mineOwnership({ repo: dir, since: "18months", limit: 10 })
    expect(mined.rows.length).toBeGreaterThan(0)
    expect(mined.rows[0]!.meta.path).toBe("hello.txt")

    const boot = await bootstrapCodebase({ cwd: dir, skipGraph: true, limit: 10 })
    expect(boot.ownershipRows).toBeGreaterThan(0)
    expect(fs.existsSync(boot.ownershipPath)).toBe(true)
    expect(fs.existsSync(boot.nextPath)).toBe(true)
    expect(boot.sha.length).toBeGreaterThan(7)
  })
})
