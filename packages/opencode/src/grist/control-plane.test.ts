import { describe, expect, test, beforeEach } from "bun:test"
import {
  clearSessionControl,
  decideContinue,
  decidePermission,
  decideToolBudget,
  decideVerify,
  getSessionControl,
  isExploratoryTool,
  nextRung,
  rankContextNodes,
  rememberSessionControl,
  shadowContinue,
  shadowPermission,
  shadowToolBudget,
  shadowVerify,
} from "./control-plane"

describe("nextRung", () => {
  test("climbs the ladder", () => {
    expect(nextRung("cheapest")).toBe("medium")
    expect(nextRung("medium")).toBe("frontier")
    expect(nextRung("frontier")).toBeUndefined()
  })
})

describe("shadowContinue", () => {
  test("first step always continues", () => {
    const d = shadowContinue({ step: 1, tools: { count: 0, failed: 0, names: [] } })
    expect(d.action).toBe("continue")
  })

  test("escalates on repeated tool failure", () => {
    rememberSessionControl("s1", {
      rung: "cheapest",
      difficulty: 0.4,
      sensitivity: 0.1,
      underspecified: 0.1,
      task: "fix the flaky test",
    })
    const d = shadowContinue({
      step: 3,
      control: {
        rung: "cheapest",
        difficulty: 0.4,
        sensitivity: 0.1,
        underspecified: 0.1,
        task: "fix",
        exploratory: 2,
        edits: 0,
        escalated: false,
      },
      tools: { count: 4, failed: 2, names: ["edit", "bash"] },
    })
    expect(d.action).toBe("escalate")
    expect(d.rung).toBe("medium")
    clearSessionControl("s1")
  })

  test("does not stop when edits landed on an easy task", () => {
    const d = shadowContinue({
      step: 4,
      control: {
        rung: "cheapest",
        difficulty: 0.2,
        sensitivity: 0.1,
        underspecified: 0.1,
        task: "rename helper",
        exploratory: 3,
        edits: 1,
        escalated: false,
      },
      tools: { count: 3, failed: 0, names: ["grep", "edit"] },
    })
    expect(d.action).toBe("continue")
  })

  test("only ever continues or escalates, even past the old step budgets", () => {
    const control = {
      rung: "cheapest" as const,
      difficulty: 0.6,
      sensitivity: 0.1,
      underspecified: 0.1,
      task: "update pricing across files",
      exploratory: 3,
      edits: 2,
      escalated: false,
    }
    for (const step of [12, 24, 48]) {
      const d = shadowContinue({
        step,
        control,
        tools: { count: 5, failed: 0, names: ["edit", "edit", "bash"], verified: true },
      })
      expect(d.action).toBe("continue")
    }
  })
})

describe("shadowPermission", () => {
  test("auto-allows low-sensitivity edits", () => {
    const d = shadowPermission({
      permission: "edit",
      patterns: ["src/util/foo.ts"],
      sensitivity: 0.1,
    })
    expect(d.action).toBe("allow")
  })

  test("asks on destructive shell", () => {
    const d = shadowPermission({
      permission: "bash",
      patterns: ["rm -rf /"],
      metadata: { command: "rm -rf /" },
      sensitivity: 0.1,
    })
    expect(d.action).toBe("ask")
  })

  test("asks when sensitivity is high", () => {
    const d = shadowPermission({
      permission: "edit",
      patterns: ["src/util/foo.ts"],
      sensitivity: 0.8,
    })
    expect(d.action).toBe("ask")
  })
})

describe("shadowVerify", () => {
  test("requires verify on auth paths", () => {
    const d = shadowVerify({ filePath: "src/auth/session.ts", sensitivity: 0.2, edits: 1 })
    expect(d.action).toBe("require")
    expect(d.message).toContain("grist:verify")
  })

  test("nudges after ordinary edits", () => {
    const d = shadowVerify({ filePath: "src/util/format.ts", sensitivity: 0.2, edits: 2 })
    expect(d.action).toBe("nudge")
  })
})

describe("shadowToolBudget", () => {
  test("blocks exploratory tools past the cap on easy tasks", () => {
    expect(isExploratoryTool("grep")).toBe(true)
    const d = shadowToolBudget({ toolID: "grep", exploratory: 8, difficulty: 0.2, cap: 8 })
    expect(d.action).toBe("block")
  })

  test("allows edits always", () => {
    const d = shadowToolBudget({ toolID: "edit", exploratory: 99, difficulty: 0.1, cap: 8 })
    expect(d.action).toBe("allow")
  })
})

describe("decide* with GRIST_CTRL=off", () => {
  beforeEach(() => {
    process.env.GRIST_CTRL = "off"
  })

  test("continue is passthrough", async () => {
    const d = await decideContinue({ sessionID: "x", step: 5, parts: [] })
    expect(d.action).toBe("continue")
    expect(d.reasons).toContain("ctrl_off")
    delete process.env.GRIST_CTRL
  })

  test("permission asks", async () => {
    const d = await decidePermission({ permission: "edit", patterns: ["a.ts"] })
    expect(d.action).toBe("ask")
    delete process.env.GRIST_CTRL
  })
})

describe("rankContextNodes", () => {
  test("keeps keyword-overlapping nodes under shadow", async () => {
    process.env.GRIST_CTRL = "on"
    delete process.env.TYPESAFE_API_KEY
    const nodes = await rankContextNodes({
      task: "fix format helper in util/format.ts",
      nodes: [
        { id: "1", label: "format", sourceFile: "util/format.ts" },
        { id: "2", label: "unrelated", sourceFile: "other/z.ts" },
        { id: "3", label: "helper", sourceFile: "util/format.ts" },
      ],
      keep: 2,
    })
    expect(nodes.length).toBe(2)
    expect(nodes.some((n) => n.label === "format")).toBe(true)
    delete process.env.GRIST_CTRL
  })
})

describe("session counters via decideVerify/decideToolBudget", () => {
  test("increments edits and exploratory", async () => {
    delete process.env.GRIST_CTRL
    rememberSessionControl("sess", {
      rung: "cheapest",
      difficulty: 0.2,
      sensitivity: 0.1,
      underspecified: 0.1,
      task: "rename",
    })
    await decideVerify({ sessionID: "sess", filePath: "a.ts" })
    await decideToolBudget({ sessionID: "sess", toolID: "grep" })
    const budget = await decideToolBudget({ sessionID: "sess", toolID: "grep" })
    expect(budget.count).toBeGreaterThanOrEqual(2)
    clearSessionControl("sess")
  })
})

function toolPart(
  tool: string,
  state?: { status?: string; output?: string; input?: Record<string, unknown>; metadata?: Record<string, unknown> },
) {
  return { type: "tool", tool, state }
}

describe("decideContinue without deterministic stops", () => {
  function setup(edits: number) {
    delete process.env.TYPESAFE_API_KEY
    delete process.env.GRIST_CTRL
    rememberSessionControl("sess", {
      rung: "cheapest",
      difficulty: 0.6,
      sensitivity: 0.1,
      underspecified: 0.1,
      task: "update pricing across files",
    })
    const control = getSessionControl("sess")
    if (control) {
      control.edits = edits
      control.exploratory = 3
    }
  }

  test("continues at step 12 with verified edits (no shadow step budget)", async () => {
    setup(2)
    const d = await decideContinue({
      sessionID: "sess",
      step: 12,
      parts: [
        toolPart("edit", { status: "completed" }),
        toolPart("bash", { status: "completed", input: { command: "bun test src/grist/" } }),
      ],
    })
    expect(d.action).toBe("continue")
    clearSessionControl("sess")
  })

  test("continues past the old hard ceiling of step 24", async () => {
    setup(2)
    const d = await decideContinue({
      sessionID: "sess",
      step: 30,
      parts: [toolPart("edit", { status: "completed" })],
    })
    expect(d.action).toBe("continue")
    clearSessionControl("sess")
  })

  test("still escalates on repeated tool failure", async () => {
    setup(0)
    const d = await decideContinue({
      sessionID: "sess",
      step: 3,
      parts: [toolPart("edit", { status: "error" }), toolPart("bash", { status: "error" })],
    })
    expect(d.action).toBe("escalate")
    expect(d.rung).toBe("medium")
    clearSessionControl("sess")
  })
})
