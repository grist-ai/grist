import { createFileStore } from "./file-store"
import { ensureSupermemoryLocal } from "./ensure-local"
import { createSupermemoryStore, shouldUseSupermemory } from "./supermemory-store"
import type { MemoryStore } from "./types"

/**
 * Resolve memory backend:
 * - `GRIST_MEMORY=off` → none
 * - `GRIST_MEMORY=file` → local `.grist/memory.json`
 * - default / `supermemory` / `SUPERMEMORY_*` → managed Supermemory local sidecar
 *   (auto-starts `supermemory-server` if installed), else file fallback
 *
 * Supermemory is MIT; the engine is a binary sidecar (not an in-process lib).
 * Install once: `bunx supermemory local install`
 */
export function createMemoryStore(input?: { cwd?: string }): MemoryStore | undefined {
  if (process.env.GRIST_MEMORY === "off") return undefined
  if (process.env.GRIST_MEMORY === "file") return createFileStore({ cwd: input?.cwd })

  if (shouldUseSupermemory() || preferManagedSupermemory()) {
    return createManagedSupermemoryStore(input)
  }
  return createFileStore({ cwd: input?.cwd })
}

/** Prefer managed local whenever the binary exists (Grist-owned sidecar). */
function preferManagedSupermemory() {
  if (process.env.GRIST_MEMORY === "supermemory") return true
  if (process.env.GRIST_MEMORY === "auto" || !process.env.GRIST_MEMORY) {
    // Lazy: actual binary check happens in ensure; return a managed wrapper.
    return process.env.GRIST_MEMORY_MANAGE !== "off"
  }
  return false
}

function createManagedSupermemoryStore(input?: { cwd?: string }): MemoryStore {
  let resolved: Promise<MemoryStore> | undefined

  async function underlying(): Promise<MemoryStore> {
    if (!resolved) {
      resolved = (async () => {
        const local = await ensureSupermemoryLocal()
        if (local) {
          const store = createSupermemoryStore({
            baseURL: local.baseURL,
            apiKey: local.apiKey,
            allowUnauthenticated: true,
          })
          if (store) return store
        }
        return createFileStore({ cwd: input?.cwd })
      })()
    }
    return resolved
  }

  return {
    async status() {
      return (await underlying()).status()
    },
    async remember(raw) {
      return (await underlying()).remember(raw)
    },
    async recall(raw) {
      return (await underlying()).recall(raw)
    },
  }
}

export * from "./types"
export { isVerifiedOutcome, requireVerified, decayScore, defaultWeight } from "./verified"
export { createFileStore } from "./file-store"
export { createSupermemoryStore, shouldUseSupermemory } from "./supermemory-store"
export { ensureSupermemoryLocal, resolveSupermemoryBinary } from "./ensure-local"
export { formatHits } from "./format"
