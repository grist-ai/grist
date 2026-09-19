import path from "path"
import type { MemoryHit, MemoryRecord, MemoryStore, RecallInput, RememberInput } from "./types"
import { decayScore, requireVerified } from "./verified"

type FileShape = { records: MemoryRecord[] }

/**
 * Local JSONL-backed store for when Supermemory is not running.
 * Path: `$GRIST_MEMORY_PATH` or `<cwd>/.grist/memory.json`
 */
export function createFileStore(input?: {
  cwd?: string
  filePath?: string
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, text: string) => Promise<void>
  mkdir?: (path: string) => Promise<void>
}): MemoryStore {
  const cwd = input?.cwd ?? process.cwd()
  const filePath = input?.filePath ?? process.env.GRIST_MEMORY_PATH ?? path.join(cwd, ".grist", "memory.json")

  const readFile =
    input?.readFile ??
    (async (file: string) => {
      const fs = await import("node:fs/promises")
      return fs.readFile(file, "utf-8")
    })
  const writeFile =
    input?.writeFile ??
    (async (file: string, text: string) => {
      const fs = await import("node:fs/promises")
      await fs.writeFile(file, text, "utf-8")
    })
  const mkdir =
    input?.mkdir ??
    (async (dir: string) => {
      const fs = await import("node:fs/promises")
      await fs.mkdir(dir, { recursive: true })
    })

  async function load(): Promise<FileShape> {
    try {
      const raw = await readFile(filePath)
      const parsed = JSON.parse(raw) as FileShape
      return { records: Array.isArray(parsed.records) ? parsed.records : [] }
    } catch {
      return { records: [] }
    }
  }

  async function save(shape: FileShape) {
    await mkdir(path.dirname(filePath))
    await writeFile(filePath, JSON.stringify(shape, null, 2))
  }

  return {
    async status() {
      return {
        available: true,
        backend: "file",
        detail: filePath,
      }
    },
    async remember(raw: RememberInput) {
      const input = requireVerified(raw)
      if (!input) return undefined
      const shape = await load()
      const record: MemoryRecord = {
        id: crypto.randomUUID(),
        content: input.content,
        container: input.container,
        outcome: input.outcome,
        weight: input.weight ?? 0.75,
        createdAt: Date.now(),
        sessionID: input.sessionID,
        metadata: input.metadata,
      }
      shape.records.push(record)
      await save(shape)
      console.log(
        `[grist:memory] remember backend=file outcome=${record.outcome} container=${record.container} id=${record.id}`,
      )
      return record
    },
    async recall(input: RecallInput): Promise<MemoryHit[]> {
      const shape = await load()
      const needle = input.query.trim().toLowerCase()
      const limit = input.limit ?? 8
      const scored = shape.records
        .filter((r) => r.container === input.container)
        .map((r) => {
          const blob = r.content.toLowerCase()
          const lexical = !needle
            ? 0
            : blob.includes(needle)
              ? 1
              : needle.split(/\s+/).filter((w) => w && blob.includes(w)).length * 0.25
          return { r, score: lexical * decayScore(r) }
        })
        .filter((row) => row.score > 0)
        .toSorted((a, b) => b.score - a.score)
        .slice(0, limit)
      return scored.map((row) => ({
        content: row.r.content,
        score: row.score,
        id: row.r.id,
        outcome: row.r.outcome,
      }))
    },
  }
}
