import type { MemoryHit, MemoryRecord, MemoryStore, RecallInput, RememberInput } from "./types"
import { requireVerified } from "./verified"
import { gristLog, gristWarn } from "../debug"

/**
 * Thin HTTP client for Supermemory local / cloud (same API).
 *
 * Env:
 * - `SUPERMEMORY_API_KEY` — bearer token (printed on first local boot; optional on localhost)
 * - `SUPERMEMORY_BASE_URL` or `SUPERMEMORY_API_URL` — default `http://localhost:6767`
 *
 * Local quickstart: `bunx supermemory local install` then `supermemory-server`
 * (https://supermemory.ai/docs/self-hosting/quickstart).
 */
export function createSupermemoryStore(input?: {
  baseURL?: string
  apiKey?: string
  fetch?: typeof globalThis.fetch
  /** Force create even without a key (localhost auto-auth). */
  allowUnauthenticated?: boolean
}): MemoryStore | undefined {
  const apiKey = (input?.apiKey ?? process.env.SUPERMEMORY_API_KEY ?? "").trim()
  const baseURL = (
    input?.baseURL ??
    process.env.SUPERMEMORY_BASE_URL ??
    process.env.SUPERMEMORY_API_URL ??
    "http://localhost:6767"
  ).replace(/\/$/, "")
  const local = isLocalBaseURL(baseURL)
  const allowUnauth = input?.allowUnauthenticated ?? (local && process.env.GRIST_MEMORY !== "file")
  if (!apiKey && !allowUnauth) return undefined

  const fetchFn = input?.fetch ?? globalThis.fetch

  async function request(path: string, init: RequestInit) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const response = await fetchFn(`${baseURL}${path}`, {
      ...init,
      headers,
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
        await request("/health", { method: "GET" }).catch(async () => undefined)
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
        gristLog(
          `[grist:memory] remember backend=supermemory outcome=${record.outcome} container=${record.container} id=${record.id}`,
        )
        return record
      } catch (error) {
        gristWarn("[grist:memory] supermemory remember failed", error)
        return undefined
      }
    },
    async recall(input: RecallInput): Promise<MemoryHit[]> {
      try {
        // Local + cloud both expose /v4/search (returns `memory`); fall back to /v3/search.
        const body = JSON.stringify({
          q: input.query,
          containerTag: input.container,
          limit: input.limit ?? 8,
        })
        const result =
          (await request("/v4/search", { method: "POST", body }).catch(() => undefined)) ??
          (await request("/v3/search", { method: "POST", body }))

        type Row = {
          content?: string
          chunk?: string
          memory?: string
          score?: number
          similarity?: number
          id?: string
        }
        const parsed = result as { results?: Row[] } | Row[] | undefined
        const rows = Array.isArray(parsed) ? parsed : (parsed?.results ?? [])
        return rows.flatMap((row) => {
          const content = row.memory ?? row.content ?? row.chunk
          if (!content) return []
          return [{ content, score: row.similarity ?? row.score, id: row.id }]
        })
      } catch (error) {
        gristWarn("[grist:memory] supermemory recall failed", error)
        return []
      }
    },
  }
}

/** Prefer Supermemory when key/URL is set or local mode is requested. */
export function shouldUseSupermemory(): boolean {
  if (process.env.GRIST_MEMORY === "off" || process.env.GRIST_MEMORY === "file") return false
  if (process.env.GRIST_MEMORY === "supermemory") return true
  if ((process.env.SUPERMEMORY_API_KEY ?? "").trim()) return true
  if ((process.env.SUPERMEMORY_BASE_URL ?? process.env.SUPERMEMORY_API_URL ?? "").trim()) return true
  return false
}

function isLocalBaseURL(url: string) {
  try {
    const host = new URL(url).hostname
    return host === "localhost" || host === "127.0.0.1" || host === "::1"
  } catch {
    return false
  }
}
