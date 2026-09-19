import { createFileStore } from "./file-store"
import { createSupermemoryStore } from "./supermemory-store"
import type { MemoryStore } from "./types"

/**
 * Resolve memory backend:
 * - `GRIST_MEMORY=off` → none
 * - `SUPERMEMORY_API_KEY` set → Supermemory (self-host or cloud)
 * - else → local `.grist/memory.json` file store
 */
export function createMemoryStore(input?: { cwd?: string }): MemoryStore | undefined {
  if (process.env.GRIST_MEMORY === "off") return undefined
  const remote = createSupermemoryStore()
  if (remote) return remote
  return createFileStore({ cwd: input?.cwd })
}

export * from "./types"
export { isVerifiedOutcome, requireVerified, decayScore, defaultWeight } from "./verified"
export { createFileStore } from "./file-store"
export { createSupermemoryStore } from "./supermemory-store"
export { formatHits } from "./format"
