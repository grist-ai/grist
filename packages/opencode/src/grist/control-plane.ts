/**
 * Grist control plane — Jev (or shadow) judgments between coding-model turns.
 *
 * Strong-fit decisions:
 * - continue / stop / escalate mid-session
 * - permission auto-allow vs ask
 * - exploratory tool budget
 * - post-edit verify nudge
 * - context node ranking on escalation
 *
 * Kill switch: `GRIST_CTRL=off`
 */
import { publicModelRef, type ModelRef, type Rung } from "./rung"
import { loadOperatingMode, applyModeCap } from "./mode"
import {
  askSystemOne,
  clamp01,
  controlPlaneEnabled,
  noul01,
  score01,
  typesafeKey,
  type ChoiceAnswer,
  type NoulAnswer,
  type ScoreAnswer,
} from "./jev-client"
import type { MapNode } from "./code-map/types"
import { loadThresholds } from "./thresholds"
import { gristLog, gristWarn } from "./debug"

export type ContinueAction = "continue" | "stop" | "escalate"

export type ContinueDecision = {
  action: ContinueAction
  provider: "jev" | "shadow"
  reasons: string[]
  confidence: number
  model?: ModelRef
  rung?: Rung
  latencyMs: number
}

export type PermissionDecision = {
  action: "allow" | "ask"
  provider: "jev" | "shadow"
  reasons: string[]
  latencyMs: number
}

export type VerifyDecision = {
  action: "skip" | "nudge" | "require"
  provider: "jev" | "shadow"
  reasons: string[]
  message?: string
  latencyMs: number
}

export type ToolBudgetDecision = {
  action: "allow" | "block"
  provider: "jev" | "shadow"
  reasons: string[]
  message?: string
  count: number
  latencyMs: number
}

export type SessionControl = {
  rung: Rung
  difficulty: number
  sensitivity: number
  underspecified: number
  task: string
  exploratory: number
  edits: number
  escalated: boolean
}

const EXPLORATORY = new Set(["grep", "glob", "list", "search", "webfetch", "websearch", "codesearch"])

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])

/**
 * Shell commands that count as verification. `edit_verify` is handled
 * separately because it combines an edit and a check in one tool call.
 */
const VERIFY_COMMAND =
  /\b(bun\s+(test|typecheck)|bun\s+run\s+[^\s;&|]*(test|lint|typecheck|check|build)|tsc\b|vitest|jest|pytest|cargo\s+test|go\s+test|npm\s+(test|run\s+[^\s;&|]*(test|lint|typecheck|check|build))|yarn\s+(test|run\s+\S+)|pnpm\s+(test|run\s+\S+)|eslint|ruff|biome|oxlint|make\s+test)\b/i

const sessions = new Map<string, SessionControl>()

const DEFAULT_EXPLORATORY_CAP = 8

function exploratoryCap(env: NodeJS.ProcessEnv = process.env) {
  const n = Number(env.GRIST_CTRL_EXPLORE_CAP)
  if (!Number.isNaN(n) && n > 0) return Math.floor(n)
  return DEFAULT_EXPLORATORY_CAP
}

const DEFAULT_STEP_HARD_CAP = 24

function stepHardCap(env: NodeJS.ProcessEnv = process.env) {
  const n = Number(env.GRIST_CTRL_STEP_HARD_CAP)
  if (!Number.isNaN(n) && n > 0) return Math.floor(n)
  return DEFAULT_STEP_HARD_CAP
}

export function rememberSessionControl(
  sessionID: string,
  input: {
    rung: Rung
    difficulty: number
    sensitivity: number
    underspecified: number
    task: string
  },
) {
  const prev = sessions.get(sessionID)
  sessions.set(sessionID, {
    rung: input.rung,
    difficulty: input.difficulty,
    sensitivity: input.sensitivity,
    underspecified: input.underspecified,
    task: input.task.slice(0, 2000),
    exploratory: prev?.exploratory ?? 0,
    edits: prev?.edits ?? 0,
    escalated: prev?.escalated ?? false,
  })
}

export function clearSessionControl(sessionID: string) {
  sessions.delete(sessionID)
}

export function getSessionControl(sessionID: string | undefined) {
  if (!sessionID) return undefined
  return sessions.get(sessionID)
}

export function nextRung(rung: Rung): Rung | undefined {
  if (rung === "cheapest") return "medium"
  if (rung === "medium") return "frontier"
  return undefined
}

export function isExploratoryTool(toolID: string) {
  return EXPLORATORY.has(toolID)
}

type ToolPartLike = {
  type: string
  tool?: string
  state?: {
    status?: string
    error?: string
    output?: string
    input?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }
}

function isVerifyCommand(state: ToolPartLike["state"]) {
  const command = typeof state?.input?.command === "string" ? state.input.command : ""
  return command.length > 0 && VERIFY_COMMAND.test(command)
}

function pendingTodoCount(metadata: Record<string, unknown> | undefined) {
  const todos = metadata?.todos
  if (!Array.isArray(todos)) return 0
  return todos.filter(
    (todo) => todo !== null && typeof todo === "object" && (todo as { status?: unknown }).status !== "completed",
  ).length
}

function toolSummary(parts: ReadonlyArray<ToolPartLike>) {
  const tools = parts.filter((p) => p.type === "tool")
  const failed = tools.filter((p) => p.state?.status === "error" || Boolean(p.state?.error)).length
  const names = tools.map((p) => p.tool ?? "?").slice(-12)
  const outputs = tools
    .map((p) => (typeof p.state?.output === "string" ? p.state.output.slice(0, 120) : ""))
    .filter(Boolean)
    .slice(-4)
    .join(" | ")

  // `verified` means a successful check ran after the most recent edit, so an
  // edit always invalidates an earlier verification. `pendingTodos` reflects the
  // latest checklist written in this turn; absent todowrite it stays 0.
  let verified = false
  let pendingTodos = 0
  for (const part of tools) {
    const tool = part.tool ?? ""
    if (tool === "edit_verify") {
      verified = true
      continue
    }
    if (EDIT_TOOLS.has(tool)) {
      verified = false
      continue
    }
    if (tool === "bash" && part.state?.status !== "error" && isVerifyCommand(part.state)) verified = true
    if (tool === "todowrite") pendingTodos = pendingTodoCount(part.state?.metadata)
  }

  return {
    count: tools.length,
    failed,
    names,
    snippet: outputs.slice(0, 500),
    verified,
    pendingTodos,
  }
}

/** Shadow: stop when many successful edits and few failures; escalate on repeated tool failure. */
export function shadowContinue(input: {
  step: number
  control?: SessionControl
  tools: { count: number; failed: number; names: string[]; verified?: boolean; pendingTodos?: number }
}): ContinueDecision {
  const started = Date.now()
  const reasons: string[] = []
  if (input.step <= 1) {
    return {
      action: "continue",
      provider: "shadow",
      reasons: ["first_step"],
      confidence: 1,
      latencyMs: Date.now() - started,
    }
  }

  const failed = input.tools.failed
  const edits = input.control?.edits ?? 0
  const exploratory = input.control?.exploratory ?? 0
  const difficulty = input.control?.difficulty ?? 0.3
  const pendingTodos = input.tools.pendingTodos ?? 0
  const verified = input.tools.verified ?? false

  if (failed >= 2 && !input.control?.escalated) {
    const up = input.control ? nextRung(input.control.rung) : "medium"
    if (up) {
      reasons.push("repeated_tool_failure")
      return {
        action: "escalate",
        provider: "shadow",
        reasons,
        confidence: 0.7,
        rung: up,
        model: publicModelRef(up),
        latencyMs: Date.now() - started,
      }
    }
  }

  // Clear scoped task: edits landed and exploration already happened → stop thrashing.
  // Never stop while a checklist item is still open.
  if (edits >= 1 && failed === 0 && exploratory >= 2 && difficulty < 0.45 && input.step >= 3 && pendingTodos === 0) {
    reasons.push("task_likely_complete")
    return {
      action: "stop",
      provider: "shadow",
      reasons,
      confidence: 0.65,
      latencyMs: Date.now() - started,
    }
  }

  // Step budget only counts as complete once the last edit has been verified and
  // no checklist item remains. The incident this guards against stopped at
  // step 12 with tests, commit, and push still outstanding.
  if (input.step >= 12 && failed === 0 && edits >= 2 && pendingTodos === 0 && verified) {
    reasons.push("step_budget_complete")
    return {
      action: "stop",
      provider: "shadow",
      reasons,
      confidence: 0.6,
      latencyMs: Date.now() - started,
    }
  }

  // Hard ceiling: anti-thrash backstop. Stops regardless of verify/todo state so
  // a stuck run can never loop forever, but sits well above the soft budget.
  if (input.step >= stepHardCap()) {
    reasons.push("step_budget_hard_stop")
    return {
      action: "stop",
      provider: "shadow",
      reasons,
      confidence: 0.5,
      latencyMs: Date.now() - started,
    }
  }

  reasons.push("keep_going")
  return {
    action: "continue",
    provider: "shadow",
    reasons,
    confidence: 0.5,
    latencyMs: Date.now() - started,
  }
}

async function jevContinue(input: {
  step: number
  control: SessionControl
  tools: {
    count: number
    failed: number
    names: string[]
    snippet: string
    verified?: boolean
    pendingTodos?: number
  }
  apiKey: string
}): Promise<ContinueDecision> {
  const started = Date.now()
  const result = await askSystemOne({
    apiKey: input.apiKey,
    state: {
      product: "Grist",
      task: input.control.task,
      step: input.step,
      rung: input.control.rung,
      difficulty: input.control.difficulty,
      sensitivity: input.control.sensitivity,
      tool_count: input.tools.count,
      tool_failures: input.tools.failed,
      recent_tools: input.tools.names,
      recent_output: input.tools.snippet,
      edits: input.control.edits,
      exploratory: input.control.exploratory,
      verified: input.tools.verified ?? false,
      pending_todos: input.tools.pendingTodos ?? 0,
    },
    questions: {
      next: {
        type: "choice",
        instructions:
          "After the last coding-agent turn with tools, what should the harness do next? Prefer stop when the user task looks done; escalate when the cheap/medium model is stuck; continue otherwise.",
        criteria: {
          continue: "Another model turn is useful",
          stop: "Task appears complete; avoid another paid turn",
          escalate: "Stuck or too hard for the current rung; raise model tier",
        },
      },
      confidence: {
        type: "score",
        instructions: "How confident are you in the continue/stop/escalate choice?",
        criteria: ["Guess", "Weak", "Moderate", "Strong", "Certain"],
      },
    },
  })
  const choice = (result.answers.next as ChoiceAnswer | undefined)?.choice
  const confidence = score01(result.answers.confidence as ScoreAnswer | undefined, 5)
  const action: ContinueAction =
    choice === "stop" || choice === "escalate" || choice === "continue" ? choice : "continue"

  if (action === "escalate") {
    const up = nextRung(input.control.rung)
    if (!up) {
      return {
        action: "continue",
        provider: "jev",
        reasons: ["already_frontier"],
        confidence,
        latencyMs: Date.now() - started,
      }
    }
    const capped = applyModeCap(up, loadOperatingMode())
    return {
      action: "escalate",
      provider: "jev",
      reasons: ["jev_escalate", ...capped.reasons],
      confidence,
      rung: capped.rung,
      model: publicModelRef(capped.rung),
      latencyMs: Date.now() - started,
    }
  }

  return {
    action,
    provider: "jev",
    reasons: [`jev_${action}`],
    confidence,
    latencyMs: Date.now() - started,
  }
}

/** Before starting provider turn N>1: continue, stop early, or escalate rung. */
export async function decideContinue(input: {
  sessionID: string
  step: number
  parts: ReadonlyArray<ToolPartLike>
}): Promise<ContinueDecision> {
  const started = Date.now()
  if (!controlPlaneEnabled()) {
    return {
      action: "continue",
      provider: "shadow",
      reasons: ["ctrl_off"],
      confidence: 1,
      latencyMs: Date.now() - started,
    }
  }

  const control = getSessionControl(input.sessionID)
  const tools = toolSummary(input.parts)
  const key = typesafeKey()
  if (key && control) {
    try {
      const decision = await jevContinue({ step: input.step, control, tools, apiKey: key })
      logContinue(input.sessionID, decision)
      if (decision.action === "escalate" && decision.rung) {
        control.rung = decision.rung
        control.escalated = true
        sessions.set(input.sessionID, control)
      }
      return decision
    } catch (error) {
      gristWarn("[grist:ctrl] continue Jev failed; shadow", error)
    }
  }

  const decision = shadowContinue({ step: input.step, control, tools })
  logContinue(input.sessionID, decision)
  if (decision.action === "escalate" && decision.rung && control) {
    control.rung = decision.rung
    control.escalated = true
    sessions.set(input.sessionID, control)
  }
  return decision
}

function logContinue(sessionID: string, decision: ContinueDecision) {
  gristLog(
    `[grist:ctrl:continue] ${decision.action} via ${decision.provider} · ${decision.reasons.join(",")} · conf=${decision.confidence.toFixed(2)} · ${decision.latencyMs}ms session=${sessionID}`,
  )
}

export function shadowPermission(input: {
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  sensitivity: number
}): PermissionDecision {
  const started = Date.now()
  const reasons: string[] = []
  const joined = [...input.patterns, String(input.metadata?.command ?? "")].join(" ").toLowerCase()

  if (input.sensitivity >= loadThresholds().sensitivityCapMedium) {
    reasons.push("sensitivity_ask")
    return { action: "ask", provider: "shadow", reasons, latencyMs: Date.now() - started }
  }

  if (/(rm\s+-rf|sudo |drop\s+table|mkfs|chmod\s+777|>\s*\/etc\/)/i.test(joined)) {
    reasons.push("destructive_pattern")
    return { action: "ask", provider: "shadow", reasons, latencyMs: Date.now() - started }
  }

  if (input.permission === "external_directory") {
    reasons.push("external_directory")
    return { action: "ask", provider: "shadow", reasons, latencyMs: Date.now() - started }
  }

  if (input.permission === "edit" || input.permission === "read") {
    if (/(secret|credential|\.env|id_rsa|password)/i.test(joined)) {
      reasons.push("sensitive_path")
      return { action: "ask", provider: "shadow", reasons, latencyMs: Date.now() - started }
    }
    if (input.sensitivity < 0.35) {
      reasons.push("low_sensitivity_auto")
      return { action: "allow", provider: "shadow", reasons, latencyMs: Date.now() - started }
    }
  }

  if (
    (input.permission === "bash" || input.permission === "shell") &&
    input.sensitivity < 0.3 &&
    /^(git\s+(status|diff|log|show)|ls|pwd|cat |head |tail |rg |grep |bun\s+test|bun\s+typecheck)/i.test(joined.trim())
  ) {
    reasons.push("readonly_shell_auto")
    return { action: "allow", provider: "shadow", reasons, latencyMs: Date.now() - started }
  }

  reasons.push("default_ask")
  return { action: "ask", provider: "shadow", reasons, latencyMs: Date.now() - started }
}

/** Auto-allow low-risk permission asks using session sensitivity + optional Jev. */
export async function decidePermission(input: {
  sessionID?: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
}): Promise<PermissionDecision> {
  const started = Date.now()
  if (!controlPlaneEnabled()) {
    return { action: "ask", provider: "shadow", reasons: ["ctrl_off"], latencyMs: Date.now() - started }
  }

  const control = getSessionControl(input.sessionID)
  const sensitivity = control?.sensitivity ?? 0.4
  const key = typesafeKey()
  if (key && control) {
    try {
      const result = await askSystemOne({
        apiKey: key,
        state: {
          product: "Grist",
          task: control.task,
          sensitivity: control.sensitivity,
          permission: input.permission,
          patterns: input.patterns,
          metadata: input.metadata ?? {},
        },
        questions: {
          auto: {
            type: "noul",
            instructions:
              "Is this tool permission safe to auto-approve without interrupting the user? Yes only for low-risk, reversible, non-secret operations aligned with the task.",
            criteria: {
              true: "Safe to auto-allow",
              false: "Ask the user or keep the default prompt",
            },
          },
        },
      })
      const yes = noul01(result.answers.auto as NoulAnswer | undefined)
      const action = yes >= 0.72 && sensitivity < loadThresholds().sensitivityCapMedium ? "allow" : "ask"
      const decision: PermissionDecision = {
        action,
        provider: "jev",
        reasons: [action === "allow" ? "jev_auto_allow" : "jev_ask"],
        latencyMs: Date.now() - started,
      }
      gristLog(
        `[grist:ctrl:perm] ${decision.action} via jev · ${input.permission} · ${decision.latencyMs}ms`,
      )
      return decision
    } catch (error) {
      gristWarn("[grist:ctrl] permission Jev failed; shadow", error)
    }
  }

  const decision = shadowPermission({
    permission: input.permission,
    patterns: input.patterns,
    metadata: input.metadata,
    sensitivity,
  })
  if (decision.action === "allow") {
    gristLog(
      `[grist:ctrl:perm] allow via shadow · ${input.permission} · ${decision.reasons.join(",")} · ${decision.latencyMs}ms`,
    )
  }
  return decision
}

export function shadowVerify(input: {
  filePath: string
  sensitivity: number
  edits: number
}): VerifyDecision {
  const started = Date.now()
  const lower = input.filePath.toLowerCase()
  if (/\.(test|spec)\.[jt]sx?$/.test(lower) || /\/test\//.test(lower)) {
    return {
      action: "skip",
      provider: "shadow",
      reasons: ["editing_tests"],
      latencyMs: Date.now() - started,
    }
  }
  if (input.sensitivity >= 0.55 || /(auth|billing|payment|migrat|schema)/i.test(lower)) {
    return {
      action: "require",
      provider: "shadow",
      reasons: ["sensitive_edit"],
      message:
        "[grist:verify] Sensitive edit — run a focused check (typecheck/tests) or use edit_verify for the next change before claiming done.",
      latencyMs: Date.now() - started,
    }
  }
  if (input.edits >= 1) {
    return {
      action: "nudge",
      provider: "shadow",
      reasons: ["post_edit_nudge"],
      message:
        "[grist:verify] Prefer a quick verify (bun typecheck / targeted test) or edit_verify on the next related change.",
      latencyMs: Date.now() - started,
    }
  }
  return { action: "skip", provider: "shadow", reasons: ["first_edit"], latencyMs: Date.now() - started }
}

/** After edit/write: whether to nudge or require verification. */
export async function decideVerify(input: {
  sessionID?: string
  filePath: string
}): Promise<VerifyDecision> {
  const started = Date.now()
  if (!controlPlaneEnabled()) {
    return { action: "skip", provider: "shadow", reasons: ["ctrl_off"], latencyMs: Date.now() - started }
  }

  const control = getSessionControl(input.sessionID)
  if (control) {
    control.edits += 1
    sessions.set(input.sessionID!, control)
  }

  const key = typesafeKey()
  if (key && control) {
    try {
      const result = await askSystemOne({
        apiKey: key,
        state: {
          product: "Grist",
          task: control.task,
          file: input.filePath,
          sensitivity: control.sensitivity,
          edits: control.edits,
        },
        questions: {
          need: {
            type: "choice",
            instructions: "After this file edit, how strongly should the agent verify before more work?",
            criteria: {
              skip: "No verify needed yet",
              nudge: "Suggest a quick check",
              require: "Must verify before claiming success",
            },
          },
        },
      })
      const choice = (result.answers.need as ChoiceAnswer | undefined)?.choice
      const action: VerifyDecision["action"] =
        choice === "nudge" || choice === "require" || choice === "skip" ? choice : "nudge"
      const message =
        action === "require"
          ? "[grist:verify] Verification required — run a focused check or use edit_verify before claiming done."
          : action === "nudge"
            ? "[grist:verify] Prefer a quick verify or edit_verify on the next related change."
            : undefined
      const decision: VerifyDecision = {
        action,
        provider: "jev",
        reasons: [`jev_${action}`],
        message,
        latencyMs: Date.now() - started,
      }
      if (message) gristLog(`[grist:ctrl:verify] ${action} via jev · ${input.filePath}`)
      return decision
    } catch (error) {
      gristWarn("[grist:ctrl] verify Jev failed; shadow", error)
    }
  }

  const decision = shadowVerify({
    filePath: input.filePath,
    sensitivity: control?.sensitivity ?? 0.3,
    edits: control?.edits ?? 1,
  })
  if (decision.message) gristLog(`[grist:ctrl:verify] ${decision.action} via shadow · ${input.filePath}`)
  return decision
}

export function shadowToolBudget(input: {
  toolID: string
  exploratory: number
  difficulty: number
  cap: number
}): ToolBudgetDecision {
  const started = Date.now()
  if (!isExploratoryTool(input.toolID)) {
    return {
      action: "allow",
      provider: "shadow",
      reasons: ["not_exploratory"],
      count: input.exploratory,
      latencyMs: Date.now() - started,
    }
  }
  if (input.difficulty >= 0.55) {
    return {
      action: "allow",
      provider: "shadow",
      reasons: ["hard_task_budget"],
      count: input.exploratory,
      latencyMs: Date.now() - started,
    }
  }
  if (input.exploratory >= input.cap) {
    return {
      action: "block",
      provider: "shadow",
      reasons: ["explore_cap"],
      count: input.exploratory,
      message: `[grist:ctrl] Exploratory tool budget reached (${input.exploratory}/${input.cap}). Stop searching — edit the known target files or use edit_verify.`,
      latencyMs: Date.now() - started,
    }
  }
  return {
    action: "allow",
    provider: "shadow",
    reasons: ["under_cap"],
    count: input.exploratory,
    latencyMs: Date.now() - started,
  }
}

/** Cap exploratory grep/glob/list when the task looks clear. */
export async function decideToolBudget(input: {
  sessionID?: string
  toolID: string
}): Promise<ToolBudgetDecision> {
  const started = Date.now()
  if (!controlPlaneEnabled() || !input.sessionID) {
    return {
      action: "allow",
      provider: "shadow",
      reasons: ["ctrl_off"],
      count: 0,
      latencyMs: Date.now() - started,
    }
  }

  const control = getSessionControl(input.sessionID)
  if (!control) {
    return {
      action: "allow",
      provider: "shadow",
      reasons: ["no_session"],
      count: 0,
      latencyMs: Date.now() - started,
    }
  }

  if (isExploratoryTool(input.toolID)) {
    control.exploratory += 1
    sessions.set(input.sessionID, control)
  }

  const cap = exploratoryCap()
  const decision = shadowToolBudget({
    toolID: input.toolID,
    exploratory: control.exploratory,
    difficulty: control.difficulty,
    cap,
  })

  // Optional Jev tighten: if under soft cap but task is clear, block early.
  const key = typesafeKey()
  if (key && isExploratoryTool(input.toolID) && control.exploratory >= Math.ceil(cap / 2) && decision.action === "allow") {
    try {
      const result = await askSystemOne({
        apiKey: key,
        state: {
          product: "Grist",
          task: control.task,
          tool: input.toolID,
          exploratory: control.exploratory,
          difficulty: control.difficulty,
        },
        questions: {
          enough: {
            type: "noul",
            instructions:
              "Has the agent already explored enough to stop searching and edit? Yes means block further exploratory tools.",
            criteria: {
              true: "Enough context — edit now",
              false: "More search is still useful",
            },
          },
        },
      })
      if (noul01(result.answers.enough as NoulAnswer | undefined) >= 0.7) {
        const blocked: ToolBudgetDecision = {
          action: "block",
          provider: "jev",
          reasons: ["jev_enough_explore"],
          count: control.exploratory,
          message:
            "[grist:ctrl] Exploration looks sufficient — edit the target files (prefer edit_verify) instead of more search.",
          latencyMs: Date.now() - started,
        }
        gristLog(`[grist:ctrl:budget] block via jev · ${input.toolID} · n=${control.exploratory}`)
        return blocked
      }
    } catch (error) {
      gristWarn("[grist:ctrl] budget Jev failed; shadow", error)
    }
  }

  if (decision.action === "block") {
    gristLog(
      `[grist:ctrl:budget] block via shadow · ${input.toolID} · n=${control.exploratory} · ${decision.reasons.join(",")}`,
    )
  }
  return { ...decision, latencyMs: Date.now() - started }
}

/** Rank code-map nodes for escalation context; keep the most relevant. */
export async function rankContextNodes(input: {
  task: string
  nodes: MapNode[]
  keep?: number
}): Promise<MapNode[]> {
  const keep = input.keep ?? 12
  if (!controlPlaneEnabled() || input.nodes.length <= keep) return input.nodes

  const key = typesafeKey()
  const slice = input.nodes.slice(0, 24)
  if (key) {
    try {
      const questions: Record<string, { type: "score"; instructions: string; criteria: string[] }> = {}
      for (const [i, node] of slice.entries()) {
        questions[`n${i}`] = {
          type: "score",
          instructions: `How relevant is symbol "${node.label}"${node.sourceFile ? ` in ${node.sourceFile}` : ""} to the coding task?`,
          criteria: ["Irrelevant", "Weak", "Useful", "Likely edit target", "Must include"],
        }
      }
      const result = await askSystemOne({
        apiKey: key,
        state: { product: "Grist", task: input.task.slice(0, 1000) },
        questions,
      })
      const scored = slice
        .map((node, i) => ({
          node,
          score: score01(result.answers[`n${i}`] as ScoreAnswer | undefined, 5),
        }))
        .sort((a, b) => b.score - a.score)
      gristLog(`[grist:ctrl:ctx] ranked ${scored.length} nodes via jev keep=${keep}`)
      return scored.slice(0, keep).map((s) => s.node)
    } catch (error) {
      gristWarn("[grist:ctrl] ctx rank Jev failed; shadow", error)
    }
  }

  const tokens = input.task.toLowerCase().split(/[^a-z0-9_./-]+/).filter((t) => t.length > 2)
  const scored = slice
    .map((node) => {
      const hay = `${node.label} ${node.sourceFile ?? ""}`.toLowerCase()
      const hits = tokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0)
      return { node, score: hits + (node.sourceFile ? 0.1 : 0) }
    })
    .sort((a, b) => b.score - a.score)
  gristLog(`[grist:ctrl:ctx] ranked ${scored.length} nodes via shadow keep=${keep}`)
  return scored.slice(0, keep).map((s) => s.node)
}

export function clampScore(n: number) {
  return clamp01(n)
}
