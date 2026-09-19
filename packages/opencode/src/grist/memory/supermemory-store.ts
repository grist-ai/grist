import type { MemoryHit, MemoryRecord, MemoryStore, RecallInput, RememberInput } from "./types"
import { requireVerified } from "./verified"

/**
 * Thin HTTP client for self-hosted Supermemory (MIT).
 * Env: SUPERMEMORY_API_KEY, SUPERMEMORY_BASE_URL (default http://localhost:6767)
 *
 * Uses /v3/documents + /v3/search — same surface as the quickstart curl examples.
 */
export function createSupermemoryStore(input?: {
  baseURL?: string
  apiKey?: string
  fetch?: typeof globalThis.fetch
}): MemoryStore | undefined {
  const apiKey = (input?.apiKey ?? process.env.SUPERMEMORY_API_KEY ?? "").trim()
  if (!apiKey) return undefined
  const baseURL = (input?.baseURL ?? process.env.SUPERMEMORY_BASE_URL ?? "http://localhost:6767").replace(
    /\/$/,
    "",
  )
  const fetchFn = input?.fetch ?? globalThis.fetch

  async function request(path: string, init: RequestInit) {
    const response = await fetchFn(`${baseURL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`supermemory ${response.status}: ${body.slice(0, 200)}`)
    }
    const text = await response.text()
    if (!text) return undefined
    return JSON.parse(text) as unknown
  }

  return {
    async status() {
      try {
        await request("/health", { method: "GET" }).catch(async () => {
          // Some builds expose no /health — probe search with empty is fine; treat key as present.
          return undefined
        })
        return {
          available: true,
          backend: "supermemory",
          detail: baseURL,
        }
      } catch (error) {
        return {
          available: false,
          backend: "supermemory",
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    },
    async remember(raw: RememberInput) {
      const input = requireVerified(raw)
      if (!input) return undefined
      try {
        const payload = {
          content: input.content,
          containerTag: input.container,
          metadata: {
            outcome: input.outcome,
            weight: String(input.weight ?? 0.75),
            ...(input.sessionID ? { sessionID: input.sessionID } : {}),
            ...input.metadata,
          },
        }
        const result = (await request("/v3/documents", {
          method: "POST",
          body: JSON.stringify(payload),
        })) as { id?: string } | undefined
        const record: MemoryRecord = {
          id: result?.id ?? crypto.randomUUID(),
          content: input.content,
          container: input.container,
          outcome: input.outcome,
          weight: input.weight ?? 0.75,
          createdAt: Date.now(),
          sessionID: input.sessionID,
          metadata: input.metadata,
        }
        console.log(
          `[grist:memory] remember backend=supermemory outcome=${record.outcome} container=${record.container} id=${record.id}`,
        )
        return record
      } catch (error) {
        console.warn("[grist:memory] supermemory remember failed", error)
        return undefined
      }
    },
    async recall(input: RecallInput): Promise<MemoryHit[]> {
      try {
        const result = (await request("/v3/search", {
          method: "POST",
          body: JSON.stringify({
            q: input.query,
            containerTag: input.container,
            limit: input.limit ?? 8,
          }),
        })) as
          | { results?: Array<{ content?: string; chunk?: string; score?: number; id?: string }> }
          | Array<{ content?: string; chunk?: string; score?: number; id?: string }>
          | undefined

        const rows = Array.isArray(result) ? result : (result?.results ?? [])
        return rows.flatMap((row) => {
          const content = row.content ?? row.chunk
          if (!content) return []
          return [{ content, score: row.score, id: row.id }]
        })
      } catch (error) {
        console.warn("[grist:memory] supermemory recall failed", error)
        return []
      }
    },
  }
}
