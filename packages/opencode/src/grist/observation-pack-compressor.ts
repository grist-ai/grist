/**
 * SoL-Pi ObservationPack subagent-as-compressor (pre-POC §5, Phase 2 port).
 *
 * The gate routes once per run, so every step of a run burns rung tokens —
 * including long exploration traces. Exploration therefore runs in a subagent
 * and only a capped digest returns to the main context; the full trace never
 * enters it. This module owns the digest cap, the token/step budget and the
 * cost gate that keeps the mechanism off unless projected savings beat its cost.
 */
import { excerptEnds } from "./observation-pack"
import { sessionAllowsObservationPackCompressor } from "./mechanisms"

/**
 * Digest cap. The spec's 1KB tool-output excerpt is a starting reference, but a
 * self-contained digest must carry goal + signals + next step, so we allow
 * 4KB (~1K tokens): still small enough to protect the main context, large
 * enough for the main agent to act on without retrieval.
 */
export const DIGEST_BYTES = 4 * 1024
/** Explore subagent step budget; overrun is recorded, not fatal. */
export const STEP_BUDGET = 16
/** Explore subagent token budget (approximate, bytes/4); overrun recorded. */
export const TOKEN_BUDGET = 50_000
/** Below this projected saving, packing costs more than it saves. */
export const MIN_SAVINGS_BYTES = 2 * 1024
const SIGNAL_MAX_LINES = 8
const SIGNAL_LINE_BYTES = 240

export type CompressorLimits = {
  digestBytes: number
  maxSteps: number
  maxTokens: number
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function loadLimits(env: NodeJS.ProcessEnv = process.env): CompressorLimits {
  return {
    digestBytes: positiveInt(env.GRIST_OBS_COMPRESS_BYTES, DIGEST_BYTES),
    maxSteps: positiveInt(env.GRIST_OBS_COMPRESS_STEPS, STEP_BUDGET),
    maxTokens: positiveInt(env.GRIST_OBS_COMPRESS_TOKENS, TOKEN_BUDGET),
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf-8") / 4)
}

/** Byte-safe clamp; never splits a UTF-8 code point. */
export function clampBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ""
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text
  const buf = Buffer.from(text, "utf-8")
  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString("utf-8")
}

function firstLine(text: string, maxBytes: number): string {
  const line = text.trim().split("\n")[0] ?? ""
  return clampBytes(line, maxBytes)
}

const SIGNAL_RE = /(error|fail|failed|cannot|not found|undefined|exception|panic|traceback|TS\d{3,}|warning|deprecated|regression)/i

/** Pull actionable lines (errors, failures, file paths) out of a trace first. */
export function collectSignals(text: string, maxLines = SIGNAL_MAX_LINES): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || !SIGNAL_RE.test(line)) continue
    const clipped = clampBytes(line, SIGNAL_LINE_BYTES)
    if (seen.has(clipped)) continue
    seen.add(clipped)
    out.push(clipped)
    if (out.length >= maxLines) break
  }
  return out
}

export type CostGate = {
  pass: boolean
  savingsBytes: number
  reason: string
}

/**
 * Cost gate: the digest plus framing overhead is the compressor's cost; the
 * raw trace bytes kept out of the main context are the saving. Only pack when
 * the saving clears the framing overhead and the minimum meaningful threshold.
 */
export function costGate(input: {
  traceBytes: number
  digestBytes: number
  limits?: Partial<CompressorLimits>
}): CostGate {
  const maxDigest = input.limits?.digestBytes ?? DIGEST_BYTES
  const digest = Math.min(input.digestBytes, maxDigest)
  const overhead = 256
  const savingsBytes = input.traceBytes - (digest + overhead)
  if (savingsBytes <= 0) return { pass: false, savingsBytes: 0, reason: "cost_exceeds_savings" }
  if (savingsBytes < MIN_SAVINGS_BYTES) return { pass: false, savingsBytes, reason: "savings_below_floor" }
  return { pass: true, savingsBytes, reason: "savings_beat_cost" }
}

const EXPLORATION_RE = /(explor|investigat|diagnos|why is|what does|trace|profil|debug hang|find|locate|search|grep|where is|understand)/i

export function isExplorationTask(text: string): boolean {
  return EXPLORATION_RE.test(text)
}

export type CompressorDecision =
  | { compress: false; reason: string; savingsBytes: 0 }
  | { compress: true; reason: string; savingsBytes: number }

/**
 * Routing decision for an already-completed subagent trace. Exploration tasks
 * whose session mechanism set allows the compressor, and whose projected
 * saving beats its cost, are packed; everything else passes through.
 */
export function shouldCompress(input: {
  task: string
  sessionID?: string
  traceBytes: number
  limits?: Partial<CompressorLimits>
}): CompressorDecision {
  if (process.env.GRIST_OBS_COMPRESS === "off") return { compress: false, reason: "compress_off", savingsBytes: 0 }
  if (!sessionAllowsObservationPackCompressor(input.sessionID)) {
    return { compress: false, reason: "mechanism_off", savingsBytes: 0 }
  }
  if (!isExplorationTask(input.task)) return { compress: false, reason: "not_exploration", savingsBytes: 0 }
  const gate = costGate({
    traceBytes: input.traceBytes,
    digestBytes: input.limits?.digestBytes ?? DIGEST_BYTES,
    limits: input.limits,
  })
  if (!gate.pass) return { compress: false, reason: gate.reason, savingsBytes: 0 }
  return { compress: true, reason: gate.reason, savingsBytes: gate.savingsBytes }
}

export type CompressorTrace = {
  text: string
  steps: number
  tokens: number
}

export type CompressorResult =
  | { compressed: false; reason: string; output: string; savingsBytes: 0; steps: number; tokens: number }
  | {
      compressed: true
      reason: string
      output: string
      savingsBytes: number
      steps: number
      tokens: number
      budgetExceeded: boolean
      digestBytes: number
    }

/**
 * Build the capped, self-contained digest returned to the main context:
 * header (task + budget), the most actionable signal lines, then a head/tail
 * excerpt so late errors survive, all clamped to the digest byte cap.
 */
export function digest(input: {
  task: string
  text: string
  steps?: number
  tokens?: number
  limits?: Partial<CompressorLimits>
}): string {
  const limits: CompressorLimits = { ...loadLimits(), ...input.limits }
  const header = [
    "[grist:observation-pack] exploration digest",
    `task: ${firstLine(input.task, 160)}`,
    `budget: steps=${input.steps ?? "?"}/${limits.maxSteps} tokens~=${input.tokens ?? "?"}/${limits.maxTokens}`,
  ].join("\n")
  const footer =
    `...compressed digest (${Buffer.byteLength(input.text, "utf-8")} byte trace) ` +
    "— full trace not retained in main context; re-run a narrow search if needed..."
  const available = Math.max(
    0,
    limits.digestBytes - Buffer.byteLength(header, "utf-8") - Buffer.byteLength(footer, "utf-8") - 2,
  )

  const signals = collectSignals(input.text)
  const signalsBlock =
    signals.length > 0
      ? clampBytes(
          `signals:\n${signals.map((line) => `- ${line}`).join("\n")}`,
          Math.max(0, Math.min(available, Math.floor(available / 2))),
        )
      : ""
  const excerptBudget = Math.max(0, available - Buffer.byteLength(signalsBlock, "utf-8") - (signalsBlock ? 1 : 0))
  const body = excerptEnds(input.text, excerptBudget)

  return clampBytes([header, signalsBlock, body, footer].filter(Boolean).join("\n"), limits.digestBytes)
}

/**
 * Subagent call wrapper: run the exploration subagent under a token/step
 * budget, then return only the capped digest when the cost gate passes.
 * Overrunning the budget is recorded on the result rather than thrown, so the
 * main agent still receives an actionable answer.
 */
export async function runCompressed(input: {
  sessionID?: string
  task: string
  run: () => Promise<CompressorTrace> | CompressorTrace
  limits?: Partial<CompressorLimits>
}): Promise<CompressorResult> {
  const limits: CompressorLimits = { ...loadLimits(), ...input.limits }
  const trace = await input.run()
  const traceBytes = Buffer.byteLength(trace.text, "utf-8")
  const decision = shouldCompress({
    task: input.task,
    sessionID: input.sessionID,
    traceBytes,
    limits,
  })
  if (!decision.compress) {
    return {
      compressed: false,
      reason: decision.reason,
      output: trace.text,
      savingsBytes: 0,
      steps: trace.steps,
      tokens: trace.tokens,
    }
  }
  const output = digest({
    task: input.task,
    text: trace.text,
    steps: trace.steps,
    tokens: trace.tokens,
    limits,
  })
  return {
    compressed: true,
    reason: decision.reason,
    output,
    savingsBytes: decision.savingsBytes,
    steps: trace.steps,
    tokens: trace.tokens,
    budgetExceeded: trace.steps > limits.maxSteps || trace.tokens > limits.maxTokens,
    digestBytes: Buffer.byteLength(output, "utf-8"),
  }
}
