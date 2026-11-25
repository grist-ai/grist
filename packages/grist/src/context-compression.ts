/**
 * Content-aware context compression: shrink old tool outputs by SHAPE —
 * JSON structure, diffs, search results, logs — instead of replacing them
 * with tombstones, so the model keeps the information and drops the bulk.
 *
 * Successor to history-truncation.ts, not a replacement: compression runs
 * first against a soft byte budget; when compression alone cannot get the
 * history under the gateway's hard body cap, truncateHistory's tombstones
 * remain the backstop, unchanged.
 *
 * Invariants (all pinned by tests):
 * - Request-path only. The transform applies to the per-request message
 *   copy in `session.context`; stored session messages are never mutated,
 *   so the original output always survives in the session store — no
 *   retrieval mechanism is needed.
 * - Capture integrity: memory distillation reads the separate tool history
 *   built by `tool.execute.after` from raw results (capture.ts). Nothing
 *   here feeds it, and test/capture-integrity.test.ts proves the capture
 *   inputs are byte-identical with compression on or off.
 * - Verbatim rules: user/assistant text is never touched; the most recent
 *   tool outputs are never compressed; outputs bearing error signals are
 *   never compressed; error LINES inside a compressed log stay
 *   byte-for-byte.
 * - Deterministic and model-free: same input, same output, no LLM calls.
 * - Conservative: an unrecognized shape is left alone.
 *
 * Opt-in (DEFAULT OFF — an A/B on real sessions gates any default change):
 * per repo via `<repo>/.grist/context-compression.json`
 * (`{ "enabled": true, "budgetBytes": 120000 }`), or the
 * `GRIST_CONTEXT_COMPRESSION=1|0` env override, following the
 * GRIST_WARM_SUBAGENTS / team-memory state-file patterns.
 */
import { Message, type ToolResultPart } from "@opencode/ai"
import fs from "node:fs"
import path from "node:path"

import { controlPlaneEnabled } from "@grist-ai/logic"

import {
  DEFAULT_TRUNCATION_THRESHOLD,
  toolResultText,
  truncateHistory,
} from "./history-truncation.js"

export type CompressorKind = "json" | "diff" | "search" | "log" | "generic"

/**
 * Soft budget: compression engages when the serialized history exceeds this
 * and stops once it fits. Comfortably below the 200 KB truncation threshold
 * so ordinary sessions compress a little, early, instead of tombstoning a
 * lot, late — and the 256 KB gateway cap stays far away.
 */
export const DEFAULT_COMPRESSION_BUDGET_BYTES = 120_000

/** Budget clamps: below this compression is pointless; above the truncation threshold it is unreachable. */
export const MIN_COMPRESSION_BUDGET_BYTES = 16_384
export const MAX_COMPRESSION_BUDGET_BYTES = DEFAULT_TRUNCATION_THRESHOLD

/** The most recent tool outputs are never compressed — roughly the last two steps. */
export const RECENT_TOOL_OUTPUTS_PROTECTED = 4

/** Tool outputs smaller than this are not worth compressing (matches the truncation floor). */
const MIN_COMPRESSIBLE_BYTES = 1_024

/** A compressor must save at least this many bytes on a part to be applied. */
const MIN_PART_SAVINGS_BYTES = 64

/** Per-repo opt-in file, under `<repo>/.grist/` like team-memory.json and listener-runner.json. */
export const CONTEXT_COMPRESSION_STATE_FILE = "context-compression.json"

/** Per-session totals journal, under `<repo>/.grist/` like burn-in.jsonl. */
export const CONTEXT_COMPRESSION_STATS_FILE = "context-compression.jsonl"

// ---------------------------------------------------------------------------
// Error signals
// ---------------------------------------------------------------------------

/**
 * Strong signals: an output bearing any of these is never compressed at
 * all. Deliberately narrow (non-zero exits, stack-trace headers, failing
 * test summaries) so ordinary code mentioning "error" stays compressible;
 * weaker signals are protected at line level instead.
 */
const STRONG_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /exit(?:ed)?(?: with)? code[:\s]*[1-9]\d*/i,
  /Traceback \(most recent call last\)/,
  /\bpanic:/,
  /\bFATAL\b/,
  /\(fail\)/,
  /✗/,
  /\b[1-9]\d* (?:fail|failed|failure|failures)\b/i,
  /AssertionError/,
  /command failed/i,
]

/** Weaker per-line signals: these lines stay byte-for-byte inside compressed output. */
const ERROR_LINE_PATTERN = /\b(?:error|fatal|exception|traceback|panic|fail|failed|failure|assertion|assert)\b|✗|✘/i

/**
 * Outputs at or below this size whose text carries a hard error signal are
 * error REPORTS (a failed command's output, a failing-test summary) and are
 * never compressed. In a longer output the same signals are just lines —
 * the line-level verbatim rules protect them while the bulk compresses
 * around them; skipping every log that merely mentions a failure would
 * exempt exactly the outputs compression exists for.
 */
const ERROR_REPORT_MAX_CHARS = 4_096
const STACK_FRAME_PATTERN = /^\s+at\s+[\w$.<]+\s*\(/

function isProtectedLine(line: string): boolean {
  return ERROR_LINE_PATTERN.test(line) || STACK_FRAME_PATTERN.test(line)
}

function partBearsError(part: ToolResultPart, text: string | undefined): boolean {
  if (part.result.type === "error") return true
  const metadata = part.metadata
  if (metadata) {
    for (const key of ["exitCode", "exit"]) {
      const value = metadata[key]
      if (typeof value === "number" && value !== 0) return true
    }
  }
  if (text !== undefined && text.length <= ERROR_REPORT_MAX_CHARS) {
    return STRONG_ERROR_PATTERNS.some((pattern) => pattern.test(text))
  }
  return false
}

// ---------------------------------------------------------------------------
// Config (per-repo opt-in, default OFF)
// ---------------------------------------------------------------------------

export type ContextCompressionConfig = {
  enabled: boolean
  budgetBytes: number
  source: "env" | "file" | "default"
}

export function contextCompressionConfigPath(directory: string): string {
  return path.join(directory, ".grist", CONTEXT_COMPRESSION_STATE_FILE)
}

type FileConfig = { enabled?: boolean; budgetBytes?: number }

const fileConfigCache = new Map<string, { mtimeMs: number; size: number; config: FileConfig }>()

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readFileConfig(directory: string): FileConfig {
  const file = contextCompressionConfigPath(directory)
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    fileConfigCache.delete(file)
    return {}
  }
  const cached = fileConfigCache.get(file)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.config
  let config: FileConfig = {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
    if (isPlainObject(parsed)) {
      config = {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : undefined,
        budgetBytes: typeof parsed.budgetBytes === "number" ? parsed.budgetBytes : undefined,
      }
    }
  } catch {
    config = {}
  }
  fileConfigCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, config })
  return config
}

function clampBudget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_COMPRESSION_BUDGET_BYTES
  return Math.min(MAX_COMPRESSION_BUDGET_BYTES, Math.max(MIN_COMPRESSION_BUDGET_BYTES, Math.floor(value)))
}

/**
 * Resolve the effective config for a repo. Env wins over the state file
 * (same precedence as GRIST_WARM_SUBAGENTS over its defaults); the kill
 * switch GRIST_CTRL=off disables regardless, via controlPlaneEnabled.
 */
export function resolveContextCompression(
  directory: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ContextCompressionConfig {
  const file = directory ? readFileConfig(directory) : {}
  const budgetBytes = clampBudget(file.budgetBytes)
  if (!controlPlaneEnabled(env)) return { enabled: false, budgetBytes, source: "default" }
  const raw = env.GRIST_CONTEXT_COMPRESSION?.trim().toLowerCase()
  if (raw === "0" || raw === "false" || raw === "off") return { enabled: false, budgetBytes, source: "env" }
  if (raw === "1" || raw === "true" || raw === "on") return { enabled: true, budgetBytes, source: "env" }
  if (file.enabled === true) return { enabled: true, budgetBytes, source: "file" }
  return { enabled: false, budgetBytes, source: "default" }
}

// ---------------------------------------------------------------------------
// JSON compressor: structural collapse + minification
// ---------------------------------------------------------------------------

const JSON_ARRAY_COLLAPSE_THRESHOLD = 10
const JSON_ARRAY_KEEP_HEAD = 4
const JSON_ARRAY_KEEP_TAIL = 2
const JSON_LONG_STRING_CHARS = 2_000
const JSON_STRING_KEEP_CHARS = 600
const JSON_MAX_DEPTH = 6

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    return { ok: false }
  }
}

/** Similarity gate for array collapse: uniform primitives, or objects sharing one key set. */
function itemsSimilar(items: ReadonlyArray<unknown>): boolean {
  if (items.every((item) => typeof item === "string")) return true
  if (items.every((item) => typeof item === "number")) return true
  if (items.every((item) => typeof item === "boolean")) return true
  if (!items.every(isPlainObject)) return false
  const first = items[0]
  if (!first) return false
  const keys = Object.keys(first).sort().join("\0")
  return items.every((item) => Object.keys(item).sort().join("\0") === keys)
}

/**
 * Collapse a parsed JSON value: long arrays of similar items keep head +
 * tail with a self-describing marker element; long string values keep
 * head + tail with an inline marker. Returns the (possibly same) value
 * and whether anything changed.
 */
export function compressJsonValue(value: unknown, depth = 0): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    if (value.length <= JSON_LONG_STRING_CHARS) return { value, changed: false }
    const head = value.slice(0, JSON_STRING_KEEP_CHARS)
    const tail = value.slice(-JSON_STRING_KEEP_CHARS)
    return {
      value: `${head} …[grist: ${value.length - JSON_STRING_KEEP_CHARS * 2} chars omitted]… ${tail}`,
      changed: true,
    }
  }
  if (depth > JSON_MAX_DEPTH) return { value, changed: false }
  if (Array.isArray(value)) {
    if (value.length > JSON_ARRAY_COLLAPSE_THRESHOLD && itemsSimilar(value)) {
      const omitted = value.length - JSON_ARRAY_KEEP_HEAD - JSON_ARRAY_KEEP_TAIL
      const collapsed: Array<unknown> = [
        ...value.slice(0, JSON_ARRAY_KEEP_HEAD).map((item) => compressJsonValue(item, depth + 1).value),
        `[grist] … ${omitted} similar items omitted …`,
        ...value.slice(-JSON_ARRAY_KEEP_TAIL).map((item) => compressJsonValue(item, depth + 1).value),
      ]
      return { value: collapsed, changed: true }
    }
    let changed = false
    const mapped = value.map((item) => {
      const result = compressJsonValue(item, depth + 1)
      if (result.changed) changed = true
      return result.value
    })
    return { value: changed ? mapped : value, changed }
  }
  if (isPlainObject(value)) {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const result = compressJsonValue(entry, depth + 1)
      if (result.changed) changed = true
      out[key] = result.value
    }
    return { value: changed ? out : value, changed }
  }
  return { value, changed: false }
}

// ---------------------------------------------------------------------------
// Log compressor: collapse repeated lines, drop progress noise
// ---------------------------------------------------------------------------

/** A run of identical consecutive lines at or above this length collapses to one + a count marker. */
const REPEAT_MIN_RUN = 3

/** Progress-bar / spinner lines carry no information once the command finished. */
const PROGRESS_LINE_PATTERNS: ReadonlyArray<RegExp> = [
  /^\s*[#■□=>._-]{8,}\s*\d{1,3}%\s*$/,
  /^\s*\d{1,3}%\s*\|/,
  /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,
]

function compressLogLines(lines: ReadonlyArray<string>): { lines: Array<string>; changed: boolean } {
  const out: Array<string> = []
  let changed = false
  let index = 0
  while (index < lines.length) {
    const line = lines[index] as string
    let run = 1
    while (index + run < lines.length && lines[index + run] === line) run++
    if (!isProtectedLine(line) && PROGRESS_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      changed = true
      index += run
      continue
    }
    if (line === "" && run >= REPEAT_MIN_RUN) {
      out.push("")
      changed = true
      index += run
      continue
    }
    // Protected (error) lines never collapse: every copy stays verbatim.
    if (run >= REPEAT_MIN_RUN && line !== "" && !isProtectedLine(line)) {
      out.push(line, `[grist] (line above repeated ${run - 1} more times)`)
      changed = true
      index += run
      continue
    }
    out.push(line)
    index++
  }
  return { lines: out, changed }
}

// ---------------------------------------------------------------------------
// Diff compressor: dedupe repeated file sections, collapse context runs
// ---------------------------------------------------------------------------

function looksLikeDiff(lines: ReadonlyArray<string>): boolean {
  let hunks = 0
  let signed = 0
  let header = false
  for (const line of lines) {
    if (line.startsWith("@@ ")) hunks++
    else if (line.startsWith("diff --git ")) header = true
    else if (
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (line.startsWith("-") && !line.startsWith("---"))
    ) {
      signed++
    }
  }
  return hunks >= 1 && (header || signed >= 4)
}

const DIFF_CONTEXT_RUN_KEEP = 4

function compressDiffSection(lines: ReadonlyArray<string>): { lines: Array<string>; changed: boolean } {
  const out: Array<string> = []
  let changed = false
  let index = 0
  while (index < lines.length) {
    const line = lines[index] as string
    let run = 1
    while (index + run < lines.length && lines[index + run] === line) run++
    // Runs of identical added/removed lines (generated content): keep two.
    if (run >= 4 && (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")) {
      out.push(line, line, ` [grist] … line above repeated ${run - 2} more times …`)
      changed = true
      index += run
      continue
    }
    // Long runs of unchanged context: keep the edges, mark the middle.
    if (line.startsWith(" ")) {
      let contextRun = 0
      while (index + contextRun < lines.length && (lines[index + contextRun] as string).startsWith(" ")) contextRun++
      if (contextRun > DIFF_CONTEXT_RUN_KEEP) {
        out.push(...lines.slice(index, index + 2))
        out.push(` [grist] … ${contextRun - 3} unchanged lines …`)
        out.push(lines[index + contextRun - 1] as string)
        changed = true
        index += contextRun
        continue
      }
    }
    out.push(line)
    index++
  }
  return { lines: out, changed }
}

function compressDiffLines(lines: ReadonlyArray<string>): { lines: Array<string>; changed: boolean } {
  // Split into per-file sections on `diff --git` headers; a headerless diff is one section.
  const sections: Array<Array<string>> = []
  for (const line of lines) {
    if (line.startsWith("diff --git ") || sections.length === 0) sections.push([line])
    else (sections[sections.length - 1] as Array<string>).push(line)
  }
  const seen = new Set<string>()
  const out: Array<string> = []
  let changed = false
  for (const section of sections) {
    const key = section.join("\n")
    if (seen.has(key)) {
      const match = (section[0] as string).match(/^diff --git a\/(.+?) b\/(.+)$/)
      out.push(`[grist] … identical diff for ${match?.[2] ?? "this file"} omitted (same change shown above) …`)
      changed = true
      continue
    }
    seen.add(key)
    const compressed = compressDiffSection(section)
    if (compressed.changed) changed = true
    out.push(...compressed.lines)
  }
  return { lines: out, changed }
}

// ---------------------------------------------------------------------------
// Search compressor: dedupe matches, cap per file, cap repeated content
// ---------------------------------------------------------------------------

const SEARCH_LINE_PATTERN = /^(.+?):(\d+)(?::(\d+))?:(.*)$/
const SEARCH_MIN_MATCHES = 8
const SEARCH_PER_FILE_KEEP = 6
const SEARCH_SAME_CONTENT_KEEP = 3

function looksLikeSearch(lines: ReadonlyArray<string>): boolean {
  if (lines.length < SEARCH_MIN_MATCHES) return false
  const matches = lines.filter((line) => SEARCH_LINE_PATTERN.test(line)).length
  return matches >= SEARCH_MIN_MATCHES && matches / lines.length >= 0.6
}

function compressSearchLines(lines: ReadonlyArray<string>): { lines: Array<string>; changed: boolean } {
  const seenLines = new Set<string>()
  const perFile = new Map<string, number>()
  const perFileOmitted = new Map<string, number>()
  const contentSeen = new Map<string, number>()
  const out: Array<string> = []
  let duplicates = 0
  let repeatedContent = 0
  for (const line of lines) {
    const match = line.match(SEARCH_LINE_PATTERN)
    if (!match) {
      out.push(line)
      continue
    }
    if (seenLines.has(line)) {
      duplicates++
      continue
    }
    seenLines.add(line)
    const file = match[1] as string
    const content = match[4] as string
    const fileCount = (perFile.get(file) ?? 0) + 1
    perFile.set(file, fileCount)
    if (fileCount > SEARCH_PER_FILE_KEEP) {
      perFileOmitted.set(file, (perFileOmitted.get(file) ?? 0) + 1)
      continue
    }
    const contentCount = (contentSeen.get(content) ?? 0) + 1
    contentSeen.set(content, contentCount)
    if (contentCount > SEARCH_SAME_CONTENT_KEEP) {
      repeatedContent++
      continue
    }
    out.push(line)
  }
  let changed = duplicates > 0 || repeatedContent > 0 || perFileOmitted.size > 0
  for (const [file, omitted] of perFileOmitted) out.push(`[grist] … ${omitted} more matches in ${file} omitted …`)
  if (duplicates > 0) out.push(`[grist] … ${duplicates} duplicate match lines omitted …`)
  if (repeatedContent > 0) out.push(`[grist] … ${repeatedContent} repeated identical matches omitted …`)
  if (out.length >= lines.length) changed = false
  return { lines: changed ? out : [...lines], changed }
}

// ---------------------------------------------------------------------------
// Generic compressor: head/tail with error lines preserved from the middle
// ---------------------------------------------------------------------------

const GENERIC_HEAD_TAIL_MIN_CHARS = 6_000
const GENERIC_MIN_LINES_FOR_LINE_MODE = 40
const GENERIC_HEAD_LINES = 25
const GENERIC_TAIL_LINES = 50
const GENERIC_HEAD_CHARS = 1_500
const GENERIC_TAIL_CHARS = 2_500

function headTailLines(lines: ReadonlyArray<string>): { lines: Array<string>; changed: boolean } {
  if (lines.length <= GENERIC_HEAD_LINES + GENERIC_TAIL_LINES + 10) return { lines: [...lines], changed: false }
  const head = lines.slice(0, GENERIC_HEAD_LINES)
  const tail = lines.slice(-GENERIC_TAIL_LINES)
  const middle = lines.slice(GENERIC_HEAD_LINES, lines.length - GENERIC_TAIL_LINES)
  const preserved = middle.filter(isProtectedLine)
  const omitted = middle.length - preserved.length
  const marker =
    preserved.length > 0
      ? `[grist] … ${omitted} lines omitted (${preserved.length} error lines kept verbatim below) …`
      : `[grist] … ${omitted} lines omitted …`
  return { lines: [...head, marker, ...preserved, ...tail], changed: true }
}

function headTailChars(text: string): string | undefined {
  if (text.length <= GENERIC_HEAD_CHARS + GENERIC_TAIL_CHARS + 200) return undefined
  const omitted = text.length - GENERIC_HEAD_CHARS - GENERIC_TAIL_CHARS
  return `${text.slice(0, GENERIC_HEAD_CHARS)}\n…[grist: ${omitted} chars omitted]…\n${text.slice(-GENERIC_TAIL_CHARS)}`
}

// ---------------------------------------------------------------------------
// Text pipeline: pick compressors by shape, oldest tool output in, smaller out
// ---------------------------------------------------------------------------

const LOG_MIN_LINES = 20

function savingsEnough(before: string, after: string): boolean {
  return before.length - after.length >= MIN_PART_SAVINGS_BYTES
}

/**
 * Compress one tool output's text. Returns undefined when the shape is
 * unrecognized or nothing saves enough — the caller leaves the part alone.
 */
export function compressToolOutputText(text: string): { text: string; kinds: Array<CompressorKind> } | undefined {
  const direct = compressText(text)
  // The read tool wraps file content in a numbered envelope ("Read file …,
  // lines A-B" + one "N: " prefix per line), which hides the payload's real
  // shape from every compressor. When the envelope is unmistakable, also
  // try the de-numbered payload and keep whichever result is smaller; the
  // header is retained with a note that the numbers are gone.
  const envelope = stripLineNumberEnvelope(text)
  if (!envelope) return direct
  const inner = compressText(envelope.body)
  if (!inner) return direct
  const rebuilt = envelope.header ? `${envelope.header} (compressed; line numbers removed)\n${inner.text}` : inner.text
  if (direct && direct.text.length <= rebuilt.length) return direct
  return { text: rebuilt, kinds: inner.kinds }
}

/**
 * Detect the read tool's numbered envelope: an optional "Read file …,
 * lines A-B" header, then ≥90% of lines carrying a "N: " prefix. Returns
 * the header and the de-numbered body, or undefined when the shape is not
 * unmistakably an envelope (a false positive would corrupt real content).
 */
function stripLineNumberEnvelope(text: string): { header?: string; body: string } | undefined {
  const lines = text.split("\n")
  const header = /^Read file .+, lines \d+-\d+$/.test(lines[0] ?? "") ? lines[0] : undefined
  const body = header ? lines.slice(1) : lines
  if (body.length < 10) return undefined
  let numbered = 0
  for (const line of body) if (/^\d+: /.test(line)) numbered++
  if (numbered / body.length < 0.9) return undefined
  return { header, body: body.map((line) => line.replace(/^\d+: /, "")).join("\n") }
}

function compressText(text: string): { text: string; kinds: Array<CompressorKind> } | undefined {
  const parsed = tryParseJson(text)
  if (parsed.ok) {
    // A JSON payload compresses structurally or not at all; running the
    // line compressors over JSON text would corrupt its shape.
    const serialized = JSON.stringify(compressJsonValue(parsed.value).value)
    if (serialized !== undefined && savingsEnough(text, serialized)) return { text: serialized, kinds: ["json"] }
    return undefined
  }
  const lines = text.split("\n")
  const kinds: Array<CompressorKind> = []
  let working = lines
  let changed = false
  if (looksLikeDiff(lines)) {
    const result = compressDiffLines(lines)
    working = result.lines
    if (result.changed) {
      kinds.push("diff")
      changed = true
    }
  } else if (looksLikeSearch(lines)) {
    const result = compressSearchLines(lines)
    working = result.lines
    if (result.changed) {
      kinds.push("search")
      changed = true
    }
  } else if (lines.length >= LOG_MIN_LINES) {
    const result = compressLogLines(lines)
    working = result.lines
    if (result.changed) {
      kinds.push("log")
      changed = true
    }
  }
  let result = working.join("\n")
  if (result.length > GENERIC_HEAD_TAIL_MIN_CHARS) {
    if (working.length >= GENERIC_MIN_LINES_FOR_LINE_MODE) {
      const headTail = headTailLines(working)
      if (headTail.changed) {
        result = headTail.lines.join("\n")
        kinds.push("generic")
        changed = true
      }
    } else {
      const headTail = headTailChars(result)
      if (headTail !== undefined) {
        result = headTail
        kinds.push("generic")
        changed = true
      }
    }
  }
  if (!changed || !savingsEnough(text, result)) return undefined
  return { text: result, kinds }
}

// ---------------------------------------------------------------------------
// Part + history orchestration
// ---------------------------------------------------------------------------

type PartShrink = { part: ToolResultPart; dropped: number; kinds: Array<CompressorKind> }

function compressToolResultPart(part: ToolResultPart): PartShrink | undefined {
  if (part.result.type === "error") return undefined
  if (part.result.type === "json") {
    const value = part.result.value
    if (isPlainObject(value) && ("error" in value || value.ok === false)) return undefined
    const serialized = JSON.stringify(value) ?? ""
    if (serialized.length < MIN_COMPRESSIBLE_BYTES) return undefined
    // Same rule as text: a small payload carrying a hard error signal is an
    // error report; in a large payload the signal is just data.
    if (serialized.length <= ERROR_REPORT_MAX_CHARS && STRONG_ERROR_PATTERNS.some((pattern) => pattern.test(serialized))) {
      return undefined
    }
    const collapsed = compressJsonValue(value)
    if (!collapsed.changed) return undefined
    const next: ToolResultPart = { ...part, result: { type: "json", value: collapsed.value } }
    const dropped = JSON.stringify(part).length - JSON.stringify(next).length
    if (dropped < MIN_PART_SAVINGS_BYTES) return undefined
    return { part: next, dropped, kinds: ["json"] }
  }
  const text = toolResultText(part)
  if (text === undefined || text.length < MIN_COMPRESSIBLE_BYTES) return undefined
  if (partBearsError(part, text)) return undefined
  // Mixed-media content parts are left alone; all-text content compresses as one text part.
  if (part.result.type === "content" && part.result.value.some((content) => content.type !== "text")) return undefined
  const result = compressToolOutputText(text)
  if (!result) return undefined
  const next: ToolResultPart =
    part.result.type === "content"
      ? { ...part, result: { type: "content", value: [{ type: "text", text: result.text }] } }
      : { ...part, result: { type: "text", value: result.text } }
  return { part: next, dropped: JSON.stringify(part).length - JSON.stringify(next).length, kinds: result.kinds }
}

/** The most recent tool-result parts in the history — never compressed. */
function recentToolResultParts(messages: ReadonlyArray<Message>): Set<ToolResultPart> {
  const protectedParts = new Set<ToolResultPart>()
  for (let index = messages.length - 1; index >= 0 && protectedParts.size < RECENT_TOOL_OUTPUTS_PROTECTED; index--) {
    const content = (messages[index] as Message).content
    for (let position = content.length - 1; position >= 0 && protectedParts.size < RECENT_TOOL_OUTPUTS_PROTECTED; position--) {
      const part = content[position]
      if (part?.type === "tool-result") protectedParts.add(part)
    }
  }
  return protectedParts
}

export type CompressionReport = {
  /** The (possibly rebuilt) message list to send; identical when nothing changed. */
  messages: Array<Message>
  compressed: boolean
  /** True when the tombstone backstop fired after compression. */
  truncated: boolean
  bytesBefore: number
  bytesAfter: number
  bytesSaved: number
  partsCompressed: number
  byKind: Record<CompressorKind, number>
  truncatedParts: number
}

function emptyKinds(): Record<CompressorKind, number> {
  return { json: 0, diff: 0, search: 0, log: 0, generic: 0 }
}

export type CompressHistoryOptions = {
  /** Soft budget compression aims for. Default DEFAULT_COMPRESSION_BUDGET_BYTES. */
  budgetBytes?: number
  /** Hard guard for the tombstone backstop. Default DEFAULT_TRUNCATION_THRESHOLD. */
  truncationThreshold?: number
}

/**
 * Compress old tool outputs, oldest first, until the serialized history
 * fits the soft budget — then stop; later outputs keep their detail. When
 * compression alone leaves the history over the hard truncation threshold,
 * truncateHistory's tombstones finish the job exactly as they do today.
 *
 * The input array and its messages are never mutated: parts are rebuilt,
 * and when nothing changes the original array is returned as-is.
 */
export function compressHistory(
  messages: Array<Message>,
  options: CompressHistoryOptions = {},
): CompressionReport {
  const budget = options.budgetBytes ?? DEFAULT_COMPRESSION_BUDGET_BYTES
  const bytesBefore = JSON.stringify(messages).length
  const unchanged: CompressionReport = {
    messages,
    compressed: false,
    truncated: false,
    bytesBefore,
    bytesAfter: bytesBefore,
    bytesSaved: 0,
    partsCompressed: 0,
    byKind: emptyKinds(),
    truncatedParts: 0,
  }
  if (bytesBefore <= budget) return unchanged

  // Eligibility is per part, not per suffix: in a single-prompt run the
  // latest user message sits at the head and everything after it is the
  // run itself, so a "from the last user message onward" gate would exempt
  // the whole history (the tombstone guard has that shape and is inert in
  // such runs — compression exists to do better). The protections that
  // matter here are the system role, the recent-outputs tail, and the
  // error rules, all enforced per part below and in compressToolResultPart.
  const recent = recentToolResultParts(messages)
  const next = [...messages]
  const byKind = emptyKinds()
  let size = bytesBefore
  let partsCompressed = 0

  for (let index = 0; index < messages.length && size > budget; index++) {
    const message = next[index] as Message
    if (message.role === "system") continue
    const content = [...message.content]
    let changed = false
    for (let position = 0; position < message.content.length && size > budget; position++) {
      const part = message.content[position]
      if (part?.type !== "tool-result") continue
      if (recent.has(part)) continue
      const shrunk = compressToolResultPart(part)
      if (!shrunk) continue
      content[position] = shrunk.part
      changed = true
      size -= shrunk.dropped
      partsCompressed++
      for (const kind of shrunk.kinds) byKind[kind]++
    }
    if (changed) next[index] = Message.make({ ...message, content })
  }

  let finalMessages = partsCompressed > 0 ? next : messages
  let truncated = false
  let truncatedParts = 0
  const threshold = options.truncationThreshold ?? DEFAULT_TRUNCATION_THRESHOLD
  if (size > threshold) {
    // Backstop with the same per-part eligibility (tail index = end), so a
    // single-prompt run can still be saved from the hard cap.
    const backstop = truncateHistory(finalMessages, threshold, finalMessages.length)
    if (backstop.truncated) {
      finalMessages = backstop.messages
      truncated = true
      truncatedParts = backstop.partsShrunk
    }
  }
  if (partsCompressed === 0 && !truncated) return unchanged
  const bytesAfter = JSON.stringify(finalMessages).length
  return {
    messages: finalMessages,
    compressed: partsCompressed > 0,
    truncated,
    bytesBefore,
    bytesAfter,
    bytesSaved: bytesBefore - bytesAfter,
    partsCompressed,
    byKind,
    truncatedParts,
  }
}

// ---------------------------------------------------------------------------
// Observability: per-session totals, measured on the actual transform
// ---------------------------------------------------------------------------

export type CompressionSessionTotals = {
  /** Context builds in which compression or the backstop changed the payload. */
  requests: number
  partsCompressed: number
  bytesBefore: number
  bytesAfter: number
  bytesSaved: number
  byKind: Record<CompressorKind, number>
}

const sessionTotals = new Map<string, CompressionSessionTotals>()

export function recordCompressionReport(sessionID: string, report: CompressionReport): CompressionSessionTotals {
  const totals = sessionTotals.get(sessionID) ?? {
    requests: 0,
    partsCompressed: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    bytesSaved: 0,
    byKind: emptyKinds(),
  }
  totals.requests++
  totals.partsCompressed += report.partsCompressed
  totals.bytesBefore += report.bytesBefore
  totals.bytesAfter += report.bytesAfter
  totals.bytesSaved += report.bytesSaved
  for (const kind of Object.keys(totals.byKind) as Array<CompressorKind>) totals.byKind[kind] += report.byKind[kind]
  sessionTotals.set(sessionID, totals)
  return totals
}

export function compressionSessionTotals(sessionID: string): CompressionSessionTotals | undefined {
  return sessionTotals.get(sessionID)
}

export function clearCompressionSession(sessionID: string): void {
  sessionTotals.delete(sessionID)
}

export function compressionStatsPath(directory: string): string {
  return path.join(directory, ".grist", CONTEXT_COMPRESSION_STATS_FILE)
}

/** Append one session's totals to the repo journal (burn-in.jsonl pattern). Best-effort: never throws. */
export function appendCompressionSessionRecord(
  directory: string,
  sessionID: string,
  totals: CompressionSessionTotals,
): void {
  try {
    const file = compressionStatsPath(directory)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify({ sessionID, at: new Date().toISOString(), ...totals })}\n`)
  } catch {
    // Diagnostics must never break the agent loop.
  }
}

/** Read the repo journal back (doctor / inspection surface). Empty when absent or unreadable. */
export function readCompressionSessionRecords(directory: string): Array<Record<string, unknown>> {
  try {
    return fs
      .readFileSync(compressionStatsPath(directory), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          const parsed: unknown = JSON.parse(line)
          return isPlainObject(parsed) ? [parsed] : []
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}
