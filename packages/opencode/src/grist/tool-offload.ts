/**
 * Eric Zakariasson §3 — tool-definition offloading.
 *
 * Tool schemas ride on every request. Most tools beyond the core file/shell
 * set are needed in a minority of conversations. Behind GRIST_TOOL_OFFLOAD=1:
 * high-frequency / first-turn tools keep full schemas; the rest stay as a
 * name + one-line pointer (stub schema) with the full JSON in
 * `.grist/tools/{group}/{id}.json` and via `load_tools`.
 *
 * Inventory (builtin registry in `tool/registry.ts`, serialized in
 * `session/tools.ts`):
 *   always-on core: bash, read, grep, glob, edit|write|edit_verify or apply_patch
 *   first-turn:     task, webfetch, memory, skill
 *   mode-owned:     plan_exit (plan mode)
 *   rare:           websearch, todowrite, question, lsp, code_map, execute, MCP
 *
 * Usage share from in-repo call sites / tests (not production logs):
 *   read/grep/glob/edit/write/bash — nearly every coding path
 *   task/webfetch/memory/skill     — first turn or doctrine
 *   websearch/todowrite/question/lsp/code_map/execute/MCP — optional, <20% of
 *   in-repo tests exercise them as the primary action.
 */

import fs from "node:fs"
import path from "node:path"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { recordGristEvent } from "./usage-log"

export type Split = "default" | "mcp-only" | "aggressive"

export type ToolPayload = {
  id: string
  description: string
  schema: JSONSchema7
  group?: string
  status?: string
}

export type CatalogEntry = {
  id: string
  group: string
  brief: string
  status?: string
  description: string
  schema: JSONSchema7
}

export type ProjectedTool = {
  id: string
  description: string
  schema: JSONSchema7
  mode: "full" | "stub" | "loader"
  group: string
}

export type CallRecord = {
  tool: string
  ok: boolean
  stub?: boolean
  error?: string
}

export const LOAD_TOOLS_ID = "load_tools"

const CORE = ["bash", "read", "grep", "glob", "edit", "write", "apply_patch", "edit_verify", "invalid"] as const
const FIRST_TURN = ["task", "webfetch", "memory", "skill"] as const
const MODE_OWNED = ["plan_exit"] as const
/** Models invent this name when it is missing; keep the full (tight) schema. */
const PRESENCE = ["websearch"] as const
const RARE = ["todowrite", "question", "lsp", "code_map", "execute"] as const

const GROUP: Record<string, string> = {
  bash: "core",
  read: "core",
  grep: "core",
  glob: "core",
  edit: "core",
  write: "core",
  apply_patch: "core",
  edit_verify: "core",
  invalid: "core",
  task: "explore",
  webfetch: "explore",
  memory: "explore",
  skill: "explore",
  websearch: "web",
  todowrite: "session",
  question: "session",
  lsp: "code-intel",
  code_map: "code-intel",
  plan_exit: "plan",
  execute: "codemode",
  [LOAD_TOOLS_ID]: "meta",
  list_mcp_resources: "mcp-resources",
  list_mcp_resource_templates: "mcp-resources",
  read_mcp_resource: "mcp-resources",
}

const SHORT: Record<string, string> = {
  bash: "Run a shell command. Prefer workdir over cd. Chain dependent commands in one call.",
  read: "Read a file or directory. filePath is absolute. Optional offset/limit for large files.",
  grep: "Regex search over file contents. Optional path and include glob.",
  glob: "Find files by glob pattern. Optional search path.",
  edit: "Replace exact text in a file. Read first. oldString must uniquely match unless replaceAll.",
  write: "Write a file. Read first if it already exists.",
  apply_patch: "Apply a Begin/End Patch to add, update, or delete files.",
  edit_verify: "Edit a file and run a verify shell command in one call.",
  task: "Launch a subagent. subagent_type selects the agent; prompt is the task.",
  webfetch: "Fetch a URL as markdown, text, or html.",
  memory: "recall verified project facts, or remember only after tests_passed / user_approved / user_corrected.",
  skill: "Load a named skill from available_skills.",
  websearch: "Search the live web.",
  todowrite: "Replace the session todo list.",
  question: "Ask the user a multiple-choice question.",
  lsp: "LSP operation (goToDefinition, hover, findReferences, documentSymbol, ...).",
  code_map: "Return a compact symbol subgraph around a seed path or name.",
  plan_exit: "Exit plan mode and ask to switch to build.",
  execute: "Run a confined orchestration script against connected MCP tools.",
  invalid: "Do not use.",
}

const BRIEFS: Record<string, string> = {
  bash: "run a shell command",
  read: "read a file or directory",
  grep: "regex search file contents",
  glob: "find files by glob",
  edit: "exact string replace in a file",
  write: "write a file",
  apply_patch: "apply a multi-file patch",
  edit_verify: "edit plus verify command",
  task: "launch a subagent",
  webfetch: "fetch a URL",
  memory: "recall or record verified facts",
  skill: "load a named skill",
  websearch: "search the live web",
  todowrite: "session todo list",
  question: "ask the user a question",
  lsp: "language-server query",
  code_map: "symbol subgraph around a seed",
  plan_exit: "exit plan mode",
  execute: "confined MCP orchestration script",
  list_mcp_resources: "list MCP resources",
  list_mcp_resource_templates: "list MCP resource templates",
  read_mcp_resource: "read an MCP resource",
}

export const STUB_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {},
  additionalProperties: true,
}

export const LOAD_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    group: {
      type: "string",
      description: 'Tool group to load, or "all" for every pending group',
    },
  },
  required: ["group"],
}

const catalogs = new Map<string, CatalogEntry[]>()
const loadedGroups = new Map<string, Set<string>>()
const calls: CallRecord[] = []

export function offloadEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.GRIST_TOOL_OFFLOAD === "1"
}

export function staticIds(split: Split = "default"): Set<string> {
  if (split === "aggressive") return new Set([...CORE, LOAD_TOOLS_ID])
  if (split === "mcp-only") {
    return new Set([...CORE, ...FIRST_TURN, ...MODE_OWNED, ...PRESENCE, ...RARE, LOAD_TOOLS_ID])
  }
  return new Set([...CORE, ...FIRST_TURN, ...MODE_OWNED, ...PRESENCE, LOAD_TOOLS_ID])
}

export function isStatic(id: string, split: Split = "default") {
  return staticIds(split).has(id)
}

export function isFirstTurn(id: string) {
  return CORE.includes(id as (typeof CORE)[number]) || FIRST_TURN.includes(id as (typeof FIRST_TURN)[number])
}

export function groupOf(id: string, override?: string) {
  if (override) return override
  if (GROUP[id]) return GROUP[id]
  if (id.startsWith("list_mcp_") || id.startsWith("read_mcp_")) return "mcp-resources"
  return "plugin"
}

export function briefOf(id: string, description: string) {
  if (BRIEFS[id]) return BRIEFS[id]
  const line = description.split("\n").find((item) => item.trim())
  if (!line) return id
  return line.replace(/^[-#*\s]+/, "").slice(0, 80)
}

export function shortDescription(id: string, original: string) {
  const short = SHORT[id]
  if (id === "task") {
    const marker = original.indexOf("Available agent types")
    const extra = marker >= 0 ? original.slice(marker).trim() : ""
    const head = short ?? firstSentence(original)
    if (!extra) return head
    return `${head}\n${extra}`
  }
  if (short) return short
  return firstSentence(original)
}

export function mcpStatusLine(status: { status: string; error?: string } | undefined) {
  if (!status) return
  switch (status.status) {
    case "connected":
      return
    case "disabled":
      return "disabled"
    case "failed":
      return status.error ? `unavailable: ${status.error}` : "unavailable"
    case "needs_auth":
    case "needs_client_registration":
      return "needs re-authentication"
    default:
      return status.status
  }
}

export function reset(sessionID?: string) {
  if (sessionID) {
    catalogs.delete(sessionID)
    loadedGroups.delete(sessionID)
    return
  }
  catalogs.clear()
  loadedGroups.clear()
  calls.length = 0
}

export function snapshotCalls() {
  return calls.slice()
}

export function recordCall(entry: CallRecord) {
  calls.push(entry)
  recordGristEvent("grist-tool-call", {
    tool: entry.tool,
    ok: entry.ok,
    stub: entry.stub === true,
    ...(entry.error ? { error: entry.error } : {}),
  })
}

export function loaded(sessionID: string) {
  return new Set(loadedGroups.get(sessionID) ?? [])
}

export function catalog(sessionID: string) {
  return catalogs.get(sessionID) ?? []
}

export function project(
  sessionID: string,
  tools: ToolPayload[],
  options: { enabled?: boolean; split?: Split } = {},
) {
  const split = options.split ?? "default"
  const enabled = options.enabled ?? true
  const entries = tools
    .filter((tool) => tool.id !== LOAD_TOOLS_ID)
    .map((tool) => {
      const group = groupOf(tool.id, tool.group)
      return {
        id: tool.id,
        group,
        brief: briefOf(tool.id, tool.description),
        status: tool.status,
        description: tool.description,
        schema: tool.schema,
      } satisfies CatalogEntry
    })
  catalogs.set(sessionID, entries)
  if (!enabled) {
    return {
      tools: entries.map((entry) => ({
        id: entry.id,
        description: entry.description,
        schema: entry.schema,
        mode: "full" as const,
        group: entry.group,
      })),
      catalog: entries,
      text: "",
    }
  }

  const already = loaded(sessionID)
  const staticSet = staticIds(split)
  const projected: ProjectedTool[] = entries.map((entry) => {
    if (staticSet.has(entry.id) || already.has(entry.group)) {
      return {
        id: entry.id,
        description: shortDescription(entry.id, entry.description),
        schema: entry.schema,
        mode: "full",
        group: entry.group,
      }
    }
    return {
      id: entry.id,
      description: stubDescription(entry),
      schema: STUB_SCHEMA,
      mode: "stub",
      group: entry.group,
    }
  })

  const pending = pendingGroups(entries, already, staticSet)
  if (pending.length > 0) {
    projected.push({
      id: LOAD_TOOLS_ID,
      description: loadDescription(pending),
      schema: LOAD_SCHEMA,
      mode: "loader",
      group: "meta",
    })
  }

  return { tools: projected, catalog: entries, text: loadDescription(pending) }
}

export function loadGroup(sessionID: string, group: string) {
  const entries = catalogs.get(sessionID) ?? []
  const current = loadedGroups.get(sessionID) ?? new Set<string>()
  if (group === "all") {
    for (const entry of entries) current.add(entry.group)
    loadedGroups.set(sessionID, current)
    return [...current]
  }
  const known = entries.some((entry) => entry.group === group)
  if (!known) return [...current]
  current.add(group)
  loadedGroups.set(sessionID, current)
  return [...current]
}

export function schemasForGroup(sessionID: string, group: string) {
  const entries = catalogs.get(sessionID) ?? []
  const selected = group === "all" ? entries : entries.filter((entry) => entry.group === group)
  return selected.map((entry) => ({
    id: entry.id,
    group: entry.group,
    brief: entry.brief,
    status: entry.status,
    description: shortDescription(entry.id, entry.description),
    schema: entry.schema,
  }))
}

export function runLoad(sessionID: string, args: unknown) {
  const group = groupArg(args)
  if (!group) {
    return {
      title: LOAD_TOOLS_ID,
      metadata: { toolOffload: true },
      output: `group is required. ${availableGroups(sessionID)}`,
    }
  }
  const before = loaded(sessionID)
  loadGroup(sessionID, group)
  const schemas = schemasForGroup(sessionID, group)
  if (schemas.length === 0) {
    return {
      title: LOAD_TOOLS_ID,
      metadata: { toolOffload: true, group },
      output: `Unknown group "${group}". ${availableGroups(sessionID)}`,
    }
  }
  return {
    title: LOAD_TOOLS_ID,
    metadata: { toolOffload: true, group, already: before.has(group) },
    output: [
      `Loaded group "${group === "all" ? "all" : group}". Full schemas:`,
      JSON.stringify(schemas, null, 2),
      "Retry the tool with these arguments on the next step.",
    ].join("\n"),
  }
}

export function runStub(sessionID: string, id: string, _args: unknown) {
  const entry = (catalogs.get(sessionID) ?? []).find((item) => item.id === id)
  const group = entry?.group ?? groupOf(id)
  loadGroup(sessionID, group)
  const schemas = schemasForGroup(sessionID, group)
  return {
    title: id,
    metadata: { toolOffload: true, group, stub: true },
    output: [
      `"${id}" is in group "${group}" — full schema was not in context.`,
      `Loaded group "${group}". Schemas:`,
      JSON.stringify(schemas, null, 2),
      "Retry this call with arguments matching the schema.",
    ].join("\n"),
  }
}

export async function writeCatalog(root: string, entries: CatalogEntry[]) {
  const dir = path.join(root, ".grist", "tools")
  fs.mkdirSync(dir, { recursive: true })
  const groups = new Map<string, CatalogEntry[]>()
  for (const entry of entries) {
    const list = groups.get(entry.group) ?? []
    list.push(entry)
    groups.set(entry.group, list)
  }
  const index = {
    groups: [...groups.entries()].map(([name, tools]) => ({
      name,
      status: tools.find((tool) => tool.status)?.status,
      tools: tools.map((tool) => tool.id),
    })),
  }
  await Bun.write(path.join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`)
  for (const entry of entries) {
    const folder = path.join(dir, sanitize(entry.group))
    fs.mkdirSync(folder, { recursive: true })
    await Bun.write(
      path.join(folder, `${sanitize(entry.id)}.json`),
      `${JSON.stringify(
        {
          id: entry.id,
          group: entry.group,
          brief: entry.brief,
          status: entry.status,
          description: entry.description,
          schema: entry.schema,
        },
        null,
        2,
      )}\n`,
    )
  }
}

export function payloadTokens(tools: Array<{ id: string; description: string; schema: JSONSchema7 }>) {
  return tools.reduce((sum, tool) => sum + Math.ceil(JSON.stringify(tool).length / 4), 0)
}

function firstSentence(text: string) {
  const line = text.split("\n").find((item) => item.trim()) ?? text.trim()
  const sliced = line.replace(/^[-#*\s]+/, "")
  const period = sliced.indexOf(". ")
  if (period < 0) return sliced.slice(0, 160)
  return sliced.slice(0, period + 1)
}

function stubDescription(entry: CatalogEntry) {
  const status = entry.status ? ` [${entry.status}]` : ""
  return `${entry.brief}${status}. Full schema: .grist/tools/${sanitize(entry.group)}/${sanitize(entry.id)}.json — call load_tools group="${entry.group}".`
}

function loadDescription(groups: Array<{ name: string; status?: string; tools: string[] }>) {
  if (groups.length === 0) return "Load full schemas for an offloaded tool group. Nothing pending."
  const lines = groups.map((group) => {
    const status = group.status ? ` (${group.status})` : ""
    return `- ${group.name}${status}: ${group.tools.join(", ")}`
  })
  return [
    "Load full schemas for an offloaded tool group. On disk: .grist/tools/{group}/{id}.json (grep/jq).",
    "Groups:",
    ...lines,
  ].join("\n")
}

function pendingGroups(entries: CatalogEntry[], already: Set<string>, staticSet: Set<string>) {
  const map = new Map<string, { name: string; status?: string; tools: string[] }>()
  for (const entry of entries) {
    if (staticSet.has(entry.id) || already.has(entry.group)) continue
    const current = map.get(entry.group) ?? { name: entry.group, status: entry.status, tools: [] }
    current.tools.push(entry.id)
    if (entry.status) current.status = entry.status
    map.set(entry.group, current)
  }
  return [...map.values()]
}

function groupArg(args: unknown) {
  if (typeof args !== "object" || args === null) return
  if (!("group" in args)) return
  const value = args.group
  if (typeof value !== "string") return
  const group = value.trim()
  if (!group) return
  return group
}

function availableGroups(sessionID: string) {
  const names = [...new Set((catalogs.get(sessionID) ?? []).map((entry) => entry.group))]
  if (names.length === 0) return "No groups in the catalog."
  return `Available groups: ${names.join(", ")}`
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
}

export const ToolOffload = {
  LOAD_TOOLS_ID,
  STUB_SCHEMA,
  LOAD_SCHEMA,
  offloadEnabled,
  staticIds,
  isStatic,
  isFirstTurn,
  groupOf,
  briefOf,
  shortDescription,
  mcpStatusLine,
  reset,
  snapshotCalls,
  recordCall,
  loaded,
  catalog,
  project,
  loadGroup,
  schemasForGroup,
  runLoad,
  runStub,
  writeCatalog,
  payloadTokens,
}
