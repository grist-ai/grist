import path from "path"
import {
  loadGraphifyDocument,
  searchNodes,
  walkSubgraph,
  type GraphifyDocument,
  type LoadedGraph,
} from "./graphify"
import type { CodeMapProvider, ProviderStatus, QueryInput } from "./types"

/**
 * Graphify provider: reads `graph.json` (NetworkX node-link) from disk.
 * Default path: `$GRIST_GRAPHIFY_PATH` or `<cwd>/graphify-out/graph.json`.
 * Build offline with Graphify CLI / skill — zero API cost for code AST pass.
 */
export function createGraphifyProvider(input?: {
  cwd?: string
  graphPath?: string
  readFile?: (path: string) => Promise<string>
}): CodeMapProvider {
  const cwd = input?.cwd ?? process.cwd()
  const graphPath =
    input?.graphPath ?? process.env.GRIST_GRAPHIFY_PATH ?? path.join(cwd, "graphify-out", "graph.json")
  const readFile =
    input?.readFile ??
    (async (file: string) => {
      const { readFile } = await import("node:fs/promises")
      return readFile(file, "utf-8")
    })

  let cached: LoadedGraph | undefined
  let cachedErr: string | undefined

  async function load(): Promise<LoadedGraph | undefined> {
    if (cached) return cached
    if (cachedErr) return undefined
    try {
      const raw = await readFile(graphPath)
      const doc = JSON.parse(raw) as GraphifyDocument
      cached = loadGraphifyDocument(doc)
      return cached
    } catch (error) {
      cachedErr = error instanceof Error ? error.message : String(error)
      return undefined
    }
  }

  return {
    id: "graphify",
    async status(): Promise<ProviderStatus> {
      const graph = await load()
      if (!graph) {
        return {
          id: "graphify",
          available: false,
          detail: cachedErr ?? `missing graph at ${graphPath}`,
          graphPath,
        }
      }
      return {
        id: "graphify",
        available: true,
        detail: `${graph.nodes.size} nodes / ${graph.edges.length} edges`,
        graphPath,
      }
    },
    async subgraph(query: QueryInput) {
      const graph = await load()
      if (!graph) return undefined
      return walkSubgraph(graph, query)
    },
    async search(query: string, limit = 20) {
      const graph = await load()
      if (!graph) return []
      return searchNodes(graph, query, limit)
    },
  }
}
