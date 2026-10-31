import { describe, expect, test } from "bun:test"
import { distillSuccesses, isTestCommand } from "./success-mining.js"

const edit = (path: string) => ({
  type: "tool",
  tool: "edit",
  state: { status: "completed", input: { path } },
})
const write = (path: string) => ({
  type: "tool",
  tool: "write",
  state: { status: "completed", input: { path } },
})
const shell = (command: string, output = "14 pass\n0 fail", status = "completed") => ({
  type: "tool",
  tool: "bash",
  state: { status, input: { command }, output },
})
const remembered = {
  type: "tool",
  tool: "memory",
  state: {
    status: "completed",
    input: { action: "remember", outcome: "tests_passed" },
    output: "[grist:memory] stored id=abc outcome=tests_passed container=repo",
  },
}

describe("isTestCommand", () => {
  test("matches test runners, not other commands", () => {
    expect(isTestCommand("bun test")).toBe(true)
    expect(isTestCommand("bun run test")).toBe(true)
    expect(isTestCommand("npm test -- --watch")).toBe(true)
    expect(isTestCommand("pytest -q")).toBe(true)
    expect(isTestCommand("go test ./...")).toBe(true)
    expect(isTestCommand("bun run test:unit")).toBe(true)
    expect(isTestCommand("bun run build")).toBe(false)
    expect(isTestCommand("bun run typecheck")).toBe(false)
    expect(isTestCommand("ls src")).toBe(false)
    expect(isTestCommand("git status")).toBe(false)
  })
})

describe("distillSuccesses", () => {
  test("edits followed by a passing check produce one verified-change memory", () => {
    const parts = [edit("/repo/src/store.ts"), write("/repo/src/server.ts"), shell("bun test")]
    const out = distillSuccesses({ parts, container: "repo" })
    expect(out).toHaveLength(1)
    expect(out[0]?.outcome).toBe("tests_passed")
    expect(out[0]?.content).toContain("src/store.ts")
    expect(out[0]?.content).toContain("src/server.ts")
    expect(out[0]?.content).toContain("14 pass, 0 fail")
    expect(out[0]?.metadata?.kind).toBe("verified_change")
    expect(out[0]?.metadata?.signature).toContain("bun test")
  })

  test("apply_patch counts as an edit (control-plane edit set)", () => {
    const patch = {
      type: "tool",
      tool: "apply_patch",
      state: { status: "completed", input: { path: "/repo/src/c.ts" } },
    }
    const out = distillSuccesses({ parts: [patch, shell("bun test")], container: "repo" })
    expect(out).toHaveLength(1)
    expect(out[0]?.content).toContain("src/c.ts")
  })

  test("legacy v1 filePath input shape is also accepted", () => {
    const legacy = {
      type: "tool",
      tool: "edit",
      state: { status: "completed", input: { filePath: "/repo/src/legacy.ts" } },
    }
    const out = distillSuccesses({ parts: [legacy, shell("bun test")], container: "repo" })
    expect(out).toHaveLength(1)
    expect(out[0]?.content).toContain("src/legacy.ts")
  })

  test("no edits — read-only session captures nothing", () => {
    expect(distillSuccesses({ parts: [shell("bun test")], container: "repo" })).toHaveLength(0)
  })

  test("edits without any check capture nothing", () => {
    expect(distillSuccesses({ parts: [edit("/repo/src/a.ts")], container: "repo" })).toHaveLength(0)
  })

  test("a check that ran before the final edit does not verify the final state", () => {
    const parts = [edit("/repo/src/a.ts"), shell("bun test"), edit("/repo/src/b.ts")]
    expect(distillSuccesses({ parts, container: "repo" })).toHaveLength(0)
  })

  test("a failing final check captures nothing", () => {
    const parts = [edit("/repo/src/a.ts"), shell("bun test", "3 pass\n2 fail", "error")]
    expect(distillSuccesses({ parts, container: "repo" })).toHaveLength(0)
  })

  test("a completed check whose output still reports failures is distrusted", () => {
    const parts = [edit("/repo/src/a.ts"), shell("bun test", "3 pass\n2 fail", "completed")]
    expect(distillSuccesses({ parts, container: "repo" })).toHaveLength(0)
  })

  test("non-test shells after the edit do not count as verification", () => {
    const parts = [edit("/repo/src/a.ts"), shell("bun run build", "build ok")]
    expect(distillSuccesses({ parts, container: "repo" })).toHaveLength(0)
  })

  test("stands down when the agent already stored a tests_passed entry", () => {
    const parts = [edit("/repo/src/a.ts"), shell("bun test"), remembered]
    expect(distillSuccesses({ parts, container: "repo" })).toHaveLength(0)
  })

  test("an agent remember that was refused does not block capture", () => {
    const refused = {
      type: "tool",
      tool: "memory",
      state: {
        status: "completed",
        input: { action: "remember", outcome: "tests_passed" },
        output: "[grist:memory] not stored — only verified outcomes are persisted",
      },
    }
    const parts = [edit("/repo/src/a.ts"), shell("bun test"), refused]
    expect(distillSuccesses({ parts, container: "repo" })).toHaveLength(1)
  })

  test("signature is stable across identical file sets and commands", () => {
    const a = distillSuccesses({
      parts: [edit("/repo/src/b.ts"), edit("/repo/src/a.ts"), shell("bun  test")],
      container: "repo",
    })
    const b = distillSuccesses({
      parts: [edit("/repo/src/a.ts"), edit("/repo/src/b.ts"), shell("bun test")],
      container: "repo",
    })
    expect(a[0]?.metadata?.signature).toBe(b[0]?.metadata?.signature)
  })
})
