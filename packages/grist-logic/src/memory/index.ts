import { createFileStore } from "./file-store.js"
import { ensureSupermemoryLocal } from "./ensure-local.js"
import { createSupermemoryStore, shouldUseSupermemory } from "./supermemory-store.js"
import type { MemoryStore } from "./types.js"

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

export * from "./types.js"
export { isVerifiedOutcome, requireVerified, decayScore, defaultWeight } from "./verified.js"
export { createFileStore } from "./file-store.js"
export { createSupermemoryStore, shouldUseSupermemory } from "./supermemory-store.js"
export { ensureSupermemoryLocal, resolveSupermemoryBinary } from "./ensure-local.js"
export { formatHits } from "./format.js"
export { renderMemoryRepo, parseMemoryRepo, type MemoryRepoFile, type ImportedMemory } from "./interchange.js"
export { planDream, applyDream, type DreamPlan } from "./dreaming.js"
