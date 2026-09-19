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

async function postLangfuse(usage: TaskUsage) {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim()
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim()
  if (!publicKey || !secretKey) return

  const id = crypto.randomUUID()
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64")
  const body = {
    batch: [
      {
        id,
        type: "generation-create",
        timestamp: new Date().toISOString(),
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
    ],
  }

  const response = await fetch(`${langfuseHost()}/api/public/ingestion`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    console.warn(`[grist:usage] Langfuse HTTP ${response.status}`)
  }
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
