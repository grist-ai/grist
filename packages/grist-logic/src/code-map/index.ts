import { createCrgProvider } from "./crg-provider.js"
import { createGraphifyProvider } from "./graphify-provider.js"
import type { CodeMapProvider, ProviderID } from "./types.js"

/** `GRIST_CODE_MAP=graphify|crg|off` (default graphify when graph present, else off). */
export function selectedProviderID(): ProviderID {
  const raw = (process.env.GRIST_CODE_MAP ?? "auto").toLowerCase()
  if (raw === "off" || raw === "none" || raw === "0") return "none"
  if (raw === "crg") return "crg"
  if (raw === "graphify") return "graphify"
  return "graphify"
}

export function createProvider(input?: {
  cwd?: string
  graphPath?: string
  id?: ProviderID
}): CodeMapProvider | undefined {
  const id = input?.id ?? selectedProviderID()
  if (id === "none") return undefined
  if (id === "crg") return createCrgProvider()
  return createGraphifyProvider({ cwd: input?.cwd, graphPath: input?.graphPath })
}

export * from "./types.js"
export * from "./minimize.js"
export { loadGraphifyDocument, walkSubgraph, searchNodes, resolveSeeds, rankContextNodes } from "./graphify.js"
export { createGraphifyProvider } from "./graphify-provider.js"
export { createCrgProvider } from "./crg-provider.js"
export { scoreRetrieval, type BakeTask, type BakeResult } from "./bakeoff.js"
