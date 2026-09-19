/**
 * Phase 3 instrument scaffold: log $/task tokens every provider step.
 * Always prints structured `[grist:usage]` lines.
 * When LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY are set, also POSTs to Langfuse
 * ingestion (no SDK dependency). Failures never throw.
 */

export type TaskUsage = {
  sessionID: string
  messageID: string
  providerID: string
  modelID: string
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  costUsd: number
}

function langfuseHost() {
  return (process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com").replace(/\/$/, "")
}

function langfuseAuth() {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim()
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim()
  if (!publicKey || !secretKey) return undefined
  return Buffer.from(`${publicKey}:${secretKey}`).toString("base64")
}

async function postLangfuseBatch(events: Array<{ type: string; body: Record<string, unknown> }>) {
  const auth = langfuseAuth()
  if (!auth) return

  const batch = events.map((event) => ({
    id: crypto.randomUUID(),
    type: event.type,
    timestamp: new Date().toISOString(),
    body: event.body,
  }))

  const response = await fetch(`${langfuseHost()}/api/public/ingestion`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ batch }),
  })
  if (!response.ok) {
    console.warn(`[grist:usage] Langfuse HTTP ${response.status}`)
  }
}

async function postLangfuse(usage: TaskUsage) {
  const id = crypto.randomUUID()
  await postLangfuseBatch([
    {
      type: "generation-create",
      body: {
        id,
        name: "grist-llm-step",
        model: `${usage.providerID}/${usage.modelID}`,
        modelParameters: {},
        usage: {
          input: usage.tokens.input,
          output: usage.tokens.output,
          total: usage.tokens.input + usage.tokens.output,
          unit: "TOKENS",
        },
        metadata: {
          sessionID: usage.sessionID,
          messageID: usage.messageID,
          costUsd: usage.costUsd,
          reasoning: usage.tokens.reasoning,
          cacheRead: usage.tokens.cache.read,
          cacheWrite: usage.tokens.cache.write,
        },
      },
    },
  ])
}

/** Fire-and-forget named event (mode/cap/diff-audit). Never throws. */
export function recordGristEvent(name: string, metadata: Record<string, unknown>): void {
  console.log(`[grist:event] ${name} ${JSON.stringify(metadata)}`)
  const id = crypto.randomUUID()
  void postLangfuseBatch([
    {
      type: "event-create",
      body: {
        id,
        name,
        metadata,
      },
    },
  ]).catch((error) => {
    console.warn("[grist:usage] Langfuse event failed", error)
  })
}

/** Fire-and-forget usage log. Never throws. */
export function recordTaskUsage(usage: TaskUsage): void {
  if (process.env.GRIST_USAGE_LOG === "off") return
  const line = {
    sessionID: usage.sessionID,
    messageID: usage.messageID,
    provider: usage.providerID,
    model: usage.modelID,
    tokens: usage.tokens,
    costUsd: Number(usage.costUsd.toFixed(6)),
  }
  console.log(`[grist:usage] ${JSON.stringify(line)}`)
  void postLangfuse(usage).catch((error) => {
    console.warn("[grist:usage] Langfuse post failed", error)
  })
}
