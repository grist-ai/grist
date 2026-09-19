import type { Confidence, MapEdge, MapNode, QueryInput, Subgraph } from "./types"

/** NetworkX node-link JSON as emitted by Graphify (`graph.json`). */
export type GraphifyDocument = {
  directed?: boolean
  multigraph?: boolean
  graph?: Record<string, unknown>
  nodes?: Array<Record<string, unknown>>
  links?: Array<Record<string, unknown>>
  edges?: Array<Record<string, unknown>>
}

export type LoadedGraph = {
  nodes: Map<string, MapNode>
  /** adjacency undirected for blast-radius style walks */
  adj: Map<string, Set<string>>
  edges: MapEdge[]
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value
  if (typeof value === "number") return String(value)
}

function confidenceOf(value: unknown): Confidence {
  if (value === "EXTRACTED" || value === "INFERRED" || value === "AMBIGUOUS") return value
  return "unknown"
}

export function loadGraphifyDocument(doc: GraphifyDocument): LoadedGraph {
  const nodes = new Map<string, MapNode>()
  for (const raw of doc.nodes ?? []) {
    const id = asString(raw.id)
    if (!id) continue
    nodes.set(id, {
      id,
      label: asString(raw.label) ?? id,
      kind: asString(raw.kind) ?? asString(raw.type),
      sourceFile: asString(raw.source_file) ?? asString(raw.sourceFile) ?? asString(raw.file),
      fileType: asString(raw.file_type) ?? asString(raw.fileType),
    })
  }

  const rawEdges = doc.links ?? doc.edges ?? []
  const edges: MapEdge[] = []
  const adj = new Map<string, Set<string>>()

  const link = (a: string, b: string) => {
    let set = adj.get(a)
    if (!set) {
      set = new Set()
      adj.set(a, set)
    }
    set.add(b)
  }

  for (const raw of rawEdges) {
    const source = asString(raw.source) ?? asString(raw.from)
    const target = asString(raw.target) ?? asString(raw.to)
    if (!source || !target) continue
    if (!nodes.has(source) || !nodes.has(target)) continue
    edges.push({
      source,
      target,
      relation: asString(raw.relation) ?? asString(raw.type) ?? "related",
      confidence: confidenceOf(raw.confidence),
    })
    link(source, target)
    link(target, source)
  }

  return { nodes, adj, edges }
}

/** Find node ids whose id, label, or sourceFile matches the seed (case-insensitive). */
export function resolveSeeds(graph: LoadedGraph, seed: string): string[] {
  const needle = seed.trim().toLowerCase()
  if (!needle) return []
  if (graph.nodes.has(seed)) return [seed]

  const hits: string[] = []
  for (const node of graph.nodes.values()) {
    if (
      node.id.toLowerCase().includes(needle) ||
      node.label.toLowerCase().includes(needle) ||
      (node.sourceFile && node.sourceFile.toLowerCase().includes(needle))
    ) {
      hits.push(node.id)
    }
  }
  return hits
}

export function walkSubgraph(
  graph: LoadedGraph,
  input: QueryInput,
): Subgraph | undefined {
  const seeds = resolveSeeds(graph, input.seed)
  if (seeds.length === 0) return undefined

  const hops = input.hops ?? 2
  const maxNodes = input.maxNodes ?? 40
  const seed = seeds[0]!
  const seen = new Set<string>([seed])
  let frontier = [seed]

  for (let depth = 0; depth < hops; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const nb of graph.adj.get(id) ?? []) {
        if (seen.has(nb)) continue
        seen.add(nb)
        next.push(nb)
        if (seen.size >= maxNodes) break
      }
      if (seen.size >= maxNodes) break
    }
    frontier = next
    if (seen.size >= maxNodes || frontier.length === 0) break
  }

  const nodes = [...seen].flatMap((id) => {
    const node = graph.nodes.get(id)
    return node ? [node] : []
  })
  const edges = graph.edges.filter((e) => seen.has(e.source) && seen.has(e.target))

  return { seed, hops, nodes, edges }
}

export function searchNodes(graph: LoadedGraph, query: string, limit = 20): MapNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const scored: Array<{ node: MapNode; score: number }> = []
  for (const node of graph.nodes.values()) {
    const label = node.label.toLowerCase()
    const id = node.id.toLowerCase()
    const file = (node.sourceFile ?? "").toLowerCase()
    let score = 0
    if (label === needle || id === needle) score = 3
    else if (label.includes(needle) || id.includes(needle)) score = 2
    else if (file.includes(needle)) score = 1
    if (score > 0) scored.push({ node, score })
  }
  return scored
    .toSorted((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label))
    .slice(0, limit)
    .map((row) => row.node)
}
