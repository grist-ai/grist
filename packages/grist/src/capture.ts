/**
 * Capture-input construction for verified-outcomes memory.
 *
 * `tool.execute.after` turns each raw tool execution into a `ToolPartLike`
 * record; those records — accumulated per session in hooks.ts — are the ONLY
 * input `distillSuccesses` / `distillFailures` ever read. They are built here,
 * from the raw execution result, before any request-path transform runs.
 *
 * Context compression (context-compression.ts) transforms the per-request
 * message copy in `session.context`; it never touches this path. The split is
 * load-bearing: if compression ever fed capture, a lossy summary could be
 * distilled into "verified" memory. test/capture-integrity.test.ts pins the
 * invariant.
 */
import type { Tool } from "@opencode/schema/tool"

/** v1 ToolPartLike shape, accumulated per session from `tool.execute.after`. */
export type ToolPartLike = {
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

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

/** The first 500 chars of a tool result's text — the snippet capture distills from. */
export function resultSnippet(result: Tool.Result): string {
  const content = result.content
  if (typeof content === "string") return content.slice(0, 500)
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .slice(0, 500)
  }
  return ""
}

/** Capture record for a completed execution, built from the RAW result (pre-nudge, pre-compression). */
export function toolPartFromResult(
  tool: string,
  args: Record<string, unknown> | undefined,
  result: Tool.Result,
): ToolPartLike {
  return {
    type: "tool",
    tool,
    state: {
      status: "completed",
      output: resultSnippet(result),
      input: args,
      metadata: asRecord(result.metadata),
    },
  }
}

/** Capture record for a failed execution. */
export function toolPartFromError(
  tool: string,
  args: Record<string, unknown> | undefined,
  errorMessage: string,
): ToolPartLike {
  return {
    type: "tool",
    tool,
    state: {
      status: "error",
      error: errorMessage,
      input: args,
    },
  }
}
