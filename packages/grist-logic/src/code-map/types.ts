/** Shared code-map algebra for Graphify vs CRG bake-off (pre-POC §6). */

export type Confidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS" | "unknown"

export type MapNode = {
  id: string
  label: string
  kind?: string
  sourceFile?: string
  fileType?: string
}

export type MapEdge = {
  source: string
  target: string
  relation: string
  confidence: Confidence
}

export type Subgraph = {
  seed: string
  hops: number
  nodes: MapNode[]
  edges: MapEdge[]
}

export type ProviderID = "graphify" | "crg" | "none"

export type ProviderStatus = {
  id: ProviderID
  available: boolean
  detail: string
  graphPath?: string
}

export type QueryInput = {
  /** Seed: file path, symbol label, or node id. */
  seed: string
  hops?: number
  /** Soft cap on nodes returned (token budget). */
  maxNodes?: number
}

export interface CodeMapProvider {
  readonly id: ProviderID
  status(): Promise<ProviderStatus>
  /** Resolve seed → subgraph for context minimization. */
  subgraph(input: QueryInput): Promise<Subgraph | undefined>
  /** Keyword / label search over nodes (for bake-off retrieval quality). */
  search(query: string, limit?: number): Promise<MapNode[]>
}
