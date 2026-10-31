import type { ToolPartLike } from "./failure-mining.js"
import type { RememberInput } from "./memory/types.js"

/**
 * R4 — success learning: the positive twin of R3 failure learning.
 *
 * Until now, positive capture depended on the agent choosing to call
 * `memory.remember` after a check passed — a doctrine nudge, not a code
 * path — so verified learnings were lost whenever the agent simply never
 * got around to it. `distillSuccesses` makes capture deterministic: it
 * reads one session's tool history and proposes a `tests_passed` memory
 * when the harness itself observed (a) completed edits and (b) a test
 * check that ran after the final edit and passed. The outcome is verified
 * by observation — the passing check ran — never by an agent's say-so,
 * exactly like `check_failed` on the failure side. No LLM summarizer: the
 * entry is composed from the observed evidence (files, command, counts).
 *
 * If the agent already stored a `tests_passed` entry this session, the
 * distiller stands down — the agent's richer, curated entry wins.
 */

/** Test-class check commands — the only executions that verify `tests_passed`. */
const TEST_COMMAND_PATTERNS: RegExp[] = [
  /\b(bun|npm|pnpm|yarn)\s+(run\s+)?test\b/,
  /\b(bun|npm|pnpm|yarn)\s+run\s+[^\s;&|]*test/,
  /\b(pytest|py\.test)\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+test\b/,
  /\bmake\s+test\b/,
  /\b(jest|vitest|mocha)\b/,
  /\bnode\s+--test\b/,
]

/** v2 names its shell tool `bash` (the control plane's verify gate keys on it). */
const SHELL_TOOLS = new Set(["bash", "shell"])
/** Same edit-tool set the control plane uses. */
const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

type ObservedCheck = { index: number; command: string; ok: boolean; output: string }

function shortPath(path: string): string {
  const segments = path.split("/").filter(Boolean)
  return segments.slice(-3).join("/")
}

function passCounts(output: string): string | undefined {
  const pass = output.match(/(\d+)\s+pass(?:ed)?\b/i)
  if (!pass) return undefined
  const fail = output.match(/(\d+)\s+fail(?:ed)?\b/i)
  return fail ? `${pass[1]} pass, ${fail[1]} fail` : `${pass[1]} pass`
}

export function distillSuccesses(input: {
  parts: ToolPartLike[]
  container: string
  sessionID?: string
}): RememberInput[] {
  const edits: { index: number; filePath: string }[] = []
  const checks: ObservedCheck[] = []
  let agentCaptured = false

  input.parts.forEach((part, index) => {
    if (part.type !== "tool" || !part.state) return
    const state = part.state
    const toolInput = state.input ?? {}
    if (part.tool && EDIT_TOOLS.has(part.tool) && state.status === "completed") {
      // v2 edit/write/apply_patch take `path`; v1 used `filePath`. Accept both.
      const filePath =
        typeof toolInput.path === "string" && toolInput.path
          ? toolInput.path
          : typeof toolInput.filePath === "string" && toolInput.filePath
            ? toolInput.filePath
            : undefined
      if (filePath) edits.push({ index, filePath })
      return
    }
    if (part.tool === "memory" && toolInput.action === "remember" && toolInput.outcome === "tests_passed") {
      // The tool result reports "stored id=…" only when the write landed.
      if ((state.output ?? "").includes("stored id=")) agentCaptured = true
      return
    }
    if (part.tool && SHELL_TOOLS.has(part.tool) && typeof toolInput.command === "string" && isTestCommand(toolInput.command)) {
      checks.push({
        index,
        command: toolInput.command.trim(),
        ok: state.status === "completed",
        output: state.output ?? "",
      })
    }
  })

  if (agentCaptured) return []
  if (edits.length === 0) return []
  const lastEdit = edits[edits.length - 1]
  if (!lastEdit) return []
  const lastCheck = checks[checks.length - 1]
  if (!lastCheck || !lastCheck.ok) return []
  // A pass recorded before the final edit verifies nothing about the
  // final state of the tree.
  if (lastCheck.index < lastEdit.index) return []
  const counts = passCounts(lastCheck.output)
  // A "completed" check whose own output reports failures is not a pass.
  if (counts && /\b[1-9]\d* fail/.test(counts)) return []

  const files = [...new Set(edits.map((edit) => edit.filePath))]
  const shown = files.slice(0, 6).map(shortPath)
  const fileList = shown.join(", ") + (files.length > shown.length ? `, +${files.length - shown.length} more` : "")
  const signature = `${[...files].sort().join(",")}|${lastCheck.command.toLowerCase().replace(/\s+/g, " ")}`
  return [
    {
      content:
        `Verified change (${input.container}): edited ${fileList}. ` +
        `Check "${lastCheck.command}" passed after the final edit${counts ? ` (${counts})` : ""}.`,
      container: input.container,
      outcome: "tests_passed" as const,
      sessionID: input.sessionID,
      metadata: { kind: "verified_change", signature },
    },
  ]
}
