import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { runGateBattery } from "./eval/battery"
import {
  LOAD_TOOLS_ID,
  STUB_SCHEMA,
  catalog,
  isFirstTurn,
  loadGroup,
  offloadEnabled,
  payloadTokens,
  project,
  recordCall,
  reset,
  runLoad,
  runStub,
  schemasForGroup,
  snapshotCalls,
  staticIds,
  writeCatalog,
  type ToolPayload,
} from "./tool-offload"
import EDIT from "../tool/edit.txt"
import EDIT_VERIFY from "../tool/edit-verify.txt"
import GREP from "../tool/grep.txt"
import GLOB from "../tool/glob.txt"
import READ from "../tool/read.txt"
import WRITE from "../tool/write.txt"
import TASK from "../tool/task.txt"
import WEBFETCH from "../tool/webfetch.txt"
import MEMORY from "../tool/memory.txt"
import SKILL from "../tool/skill.txt"
import WEBSEARCH from "../tool/websearch.txt"
import TODO from "../tool/todowrite.txt"
import QUESTION from "../tool/question.txt"
import LSP from "../tool/lsp.txt"
import CODE_MAP from "../tool/code-map.txt"
import APPLY_PATCH from "../tool/apply_patch.txt"
import SHELL_TEMPLATE from "../tool/shell/shell.txt"

const fileSchema = (extra: Record<string, JSONSchema7> = {}): JSONSchema7 => ({
  type: "object",
  properties: {
    filePath: { type: "string", description: "Absolute path" },
    ...extra,
  },
  required: ["filePath"],
})

// Rendered `ShellPrompt` pulls Global/Instance and hangs this file's import graph.
// Production bash text is this template plus the command-section lecture.
const bashDescription = [
  SHELL_TEMPLATE,
  "Before executing the command, please follow these steps:",
  "Directory verification, quoting, timeout, truncation, and git/PR lectures follow.",
  "Avoid find/grep/cat/head/tail/sed/awk; use Glob, Grep, Read, Edit, Write instead.",
  "Do not use cd; pass workdir. Chain dependent commands with && in one call.",
].join("\n")

const TASK_AGENTS = [
  TASK,
  "Available agent types and the tools they have access to:",
  "- explore: Fast codebase exploration.",
  "- general: Multi-step implementation.",
].join("\n")

function coreTools(): ToolPayload[] {
  return [
    { id: "bash", description: bashDescription, schema: fileSchema({ command: { type: "string" } }) },
    { id: "read", description: READ, schema: fileSchema({ offset: { type: "number" }, limit: { type: "number" } }) },
    { id: "grep", description: GREP, schema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
    { id: "glob", description: GLOB, schema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
    { id: "edit", description: EDIT, schema: fileSchema({ oldString: { type: "string" }, newString: { type: "string" } }) },
    { id: "write", description: WRITE, schema: fileSchema({ content: { type: "string" } }) },
    { id: "edit_verify", description: EDIT_VERIFY, schema: fileSchema({ oldString: { type: "string" }, verify: { type: "string" } }) },
    { id: "task", description: TASK_AGENTS, schema: { type: "object", properties: { prompt: { type: "string" }, subagent_type: { type: "string" } }, required: ["prompt", "subagent_type"] } },
    { id: "webfetch", description: WEBFETCH, schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
    { id: "memory", description: MEMORY, schema: { type: "object", properties: { action: { type: "string" } }, required: ["action"] } },
    { id: "skill", description: SKILL, schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
    { id: "websearch", description: WEBSEARCH, schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { id: "todowrite", description: TODO, schema: { type: "object", properties: { todos: { type: "array" } }, required: ["todos"] } },
    { id: "question", description: QUESTION, schema: { type: "object", properties: { questions: { type: "array" } }, required: ["questions"] } },
    { id: "lsp", description: LSP, schema: fileSchema({ operation: { type: "string" }, line: { type: "number" } }) },
    { id: "code_map", description: CODE_MAP, schema: { type: "object", properties: { seed: { type: "string" } }, required: ["seed"] } },
  ]
}

const githubIssue: JSONSchema7 = {
  type: "object",
  properties: {
    title: { type: "string", description: "Issue title" },
    body: { type: "string", description: "Markdown body" },
    labels: { type: "array", items: { type: "string" } },
    assignees: { type: "array", items: { type: "string" } },
  },
  required: ["title"],
}

function mcpTools(): ToolPayload[] {
  return [
    {
      id: "github_create_issue",
      description: "Create a GitHub issue in the configured repository. Provide title and optional labels.",
      schema: githubIssue,
      group: "mcp:github",
    },
    {
      id: "github_list_pulls",
      description: "List pull requests. Filter by state, base, and head.",
      schema: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["open", "closed", "all"] },
          base: { type: "string" },
          per_page: { type: "number" },
        },
      },
      group: "mcp:github",
    },
    {
      id: "github_get_file",
      description: "Read a file from a GitHub repository at a ref.",
      schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          ref: { type: "string" },
          owner: { type: "string" },
          repo: { type: "string" },
        },
        required: ["path"],
      },
      group: "mcp:github",
      status: "needs re-authentication",
    },
  ]
}

function frontierTools(): ToolPayload[] {
  return coreTools()
    .filter((tool) => tool.id !== "edit" && tool.id !== "write" && tool.id !== "edit_verify")
    .concat({
      id: "apply_patch",
      description: APPLY_PATCH,
      schema: { type: "object", properties: { patchText: { type: "string" } }, required: ["patchText"] },
    })
}

describe("GRIST_TOOL_OFFLOAD", () => {
  test("flag is off unless GRIST_TOOL_OFFLOAD=1", () => {
    expect(offloadEnabled({})).toBe(false)
    expect(offloadEnabled({ GRIST_TOOL_OFFLOAD: "1" })).toBe(true)
  })

  test("default split keeps first-turn and mode tools fully schematized", () => {
    reset("s1")
    const projected = project("s1", coreTools(), { split: "default" })
    const byId = Object.fromEntries(projected.tools.map((tool) => [tool.id, tool]))
    for (const id of ["bash", "read", "grep", "glob", "edit", "write", "task", "webfetch", "memory", "skill"]) {
      expect(isFirstTurn(id)).toBe(true)
      expect(byId[id]?.mode).toBe("full")
      expect(byId[id]?.schema).not.toEqual(STUB_SCHEMA)
    }
    expect(byId.websearch?.mode).toBe("full")
    expect(byId.todowrite?.mode).toBe("stub")
    expect(byId.question?.mode).toBe("stub")
    expect(byId.lsp?.mode).toBe("stub")
    expect(byId.code_map?.mode).toBe("stub")
    expect(byId[LOAD_TOOLS_ID]?.mode).toBe("loader")
    expect(byId[LOAD_TOOLS_ID]?.description).toContain("code-intel")
    expect(byId.task?.description).toContain("Available agent types")
    expect(byId.edit?.description.length).toBeLessThan(EDIT.length)
    expect(byId.bash?.description.length).toBeLessThan(bashDescription.length)
  })

  test("aggressive split would drop first-turn webfetch — rejected", () => {
    reset("s-agg")
    const projected = project("s-agg", coreTools(), { split: "aggressive" })
    const webfetch = projected.tools.find((tool) => tool.id === "webfetch")
    expect(staticIds("aggressive").has("webfetch")).toBe(false)
    expect(webfetch?.mode).toBe("stub")
  })

  test("load_tools then retry exposes the full schema and is not a call error", () => {
    reset()
    reset("s2")
    project("s2", coreTools(), { split: "default" })
    const before = project("s2", coreTools(), { split: "default" })
    expect(before.tools.find((tool) => tool.id === "lsp")?.mode).toBe("stub")

    const loaded = runLoad("s2", { group: "code-intel" })
    expect(loaded.output).toContain("lsp")
    expect(loaded.output).toContain("code_map")
    recordCall({ tool: LOAD_TOOLS_ID, ok: true })

    const after = project("s2", coreTools(), { split: "default" })
    const lsp = after.tools.find((tool) => tool.id === "lsp")
    expect(lsp?.mode).toBe("full")
    expect(lsp?.schema).not.toEqual(STUB_SCHEMA)

    const stub = runStub("s2", "todowrite", {})
    expect(stub.metadata.stub).toBe(true)
    expect(stub.output).toContain("todowrite")
    recordCall({ tool: "todowrite", ok: true, stub: true })

    const errors = snapshotCalls().filter((call) => !call.ok)
    expect(errors).toEqual([])
    expect(loadGroup("s2", "session")).toContain("session")
    expect(schemasForGroup("s2", "session").some((item) => item.id === "todowrite")).toBe(true)
  })

  test("MCP group status is visible on the stub and catalog", async () => {
    reset("s-mcp")
    const projected = project("s-mcp", [...coreTools(), ...mcpTools()], { split: "default" })
    const github = projected.tools.find((tool) => tool.id === "github_get_file")
    expect(github?.mode).toBe("stub")
    expect(github?.description).toContain("needs re-authentication")
    expect(projected.text).toContain("mcp:github")
    expect(projected.text).toContain("needs re-authentication")

    const dir = await mkdtemp(path.join(os.tmpdir(), "grist-tools-"))
    await writeCatalog(dir, catalog("s-mcp"))
    const index = await Bun.file(path.join(dir, ".grist/tools/index.json")).json()
    expect(index.groups.some((group: { name: string }) => group.name === "mcp:github")).toBe(true)
    const issue = await Bun.file(path.join(dir, ".grist/tools/mcp-github/github_create_issue.json")).json()
    expect(issue.schema.properties.title).toBeDefined()
  })

  test("flag off is an identity transform", () => {
    reset("s0")
    const tools = coreTools()
    const projected = project("s0", tools, { enabled: false })
    expect(projected.tools).toHaveLength(tools.length)
    expect(projected.tools.every((tool) => tool.mode === "full")).toBe(true)
    expect(projected.tools.find((tool) => tool.id === LOAD_TOOLS_ID)).toBeUndefined()
    expect(projected.tools.find((tool) => tool.id === "todowrite")?.description).toBe(TODO)
  })

  test("gate battery success is unchanged", () => {
    const { ok, pass, total } = runGateBattery()
    expect(ok).toBe(true)
    expect(pass).toBe(total)
  })

  test("before/after token counts — default split wins, aggressive rejected", () => {
    const tasks = [
      { task: "cheapest/fix-hang", tools: coreTools() },
      { task: "medium/refactor", tools: coreTools() },
      { task: "frontier/review", tools: frontierTools() },
      { task: "explore/codebase-q", tools: coreTools() },
      { task: "mcp/github-issue", tools: [...coreTools(), ...mcpTools()] },
    ]

    const rows = tasks.map((row, index) => {
      const session = `tok-${index}`
      reset(session)
      const off = project(session, row.tools, { enabled: false })
      reset(`${session}-mcp`)
      const mcpOnly = project(`${session}-mcp`, row.tools, { split: "mcp-only" })
      reset(`${session}-def`)
      const def = project(`${session}-def`, row.tools, { split: "default" })
      reset(`${session}-agg`)
      const aggressive = project(`${session}-agg`, row.tools, { split: "aggressive" })
      const before = payloadTokens(off.tools)
      return {
        task: row.task,
        before,
        mcp_only: payloadTokens(mcpOnly.tools),
        default: payloadTokens(def.tools),
        aggressive: payloadTokens(aggressive.tools),
        default_saved_pct: Math.round((1 - payloadTokens(def.tools) / before) * 1000) / 10,
        first_turn_full: def.tools
          .filter(
            (tool) =>
              isFirstTurn(tool.id) || tool.id === "apply_patch" || tool.id === "plan_exit" || tool.id === "websearch",
          )
          .every((tool) => tool.mode === "full"),
        aggressive_drops_webfetch: aggressive.tools.find((tool) => tool.id === "webfetch")?.mode !== "full",
      }
    })

    console.log("tool-offload token counts (chars/4)", rows)
    for (const row of rows) {
      expect(row.default).toBeLessThan(row.before)
      expect(row.default_saved_pct).toBeGreaterThan(20)
      expect(row.first_turn_full).toBe(true)
      expect(row.aggressive_drops_webfetch).toBe(true)
      expect(row.mcp_only).toBeLessThan(row.before)
    }
    const mcp = rows.find((row) => row.task === "mcp/github-issue")
    expect(mcp).toBeDefined()
    expect(mcp!.default_saved_pct).toBeGreaterThan(30)
  })
})
