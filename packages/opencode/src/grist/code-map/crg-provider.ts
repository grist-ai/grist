import type { CodeMapProvider, MapNode, ProviderStatus, QueryInput, Subgraph } from "./types"

/**
 * CRG (code-review-graph) provider stub.
 *
 * Full integration is MCP-native (`get_impact_radius_tool`,
 * `semantic_search_nodes_tool`). Until an MCP client is wired for bake-off
 * runs, this provider reports availability from env and returns empty results
 * so the bake-off harness can score Graphify alone or mark CRG pending.
 *
 * Enable signal: `GRIST_CRG=1` or `GRIST_CRG_MCP=1` once MCP is configured.
 */
export function createCrgProvider(input?: {
  available?: boolean
  subgraph?: (query: QueryInput) => Promise<Subgraph | undefined>
  search?: (query: string, limit?: number) => Promise<MapNode[]>
}): CodeMapProvider {
  const available =
    input?.available ?? (process.env.GRIST_CRG === "1" || process.env.GRIST_CRG_MCP === "1")

  return {
    id: "crg",
    async status(): Promise<ProviderStatus> {
      if (!available) {
        return {
          id: "crg",
          available: false,
          detail: "CRG MCP not configured (set GRIST_CRG=1 after wiring code-review-graph MCP)",
        }
      }
      return {
        id: "crg",
        available: true,
        detail: "CRG flagged available — use MCP tools for live queries until adapter lands",
      }
    },
    async subgraph(query: QueryInput) {
      if (input?.subgraph) return input.subgraph(query)
      return undefined
    },
    async search(query: string, limit = 20) {
      if (input?.search) return input.search(query, limit)
      return []
    },
  }
}
