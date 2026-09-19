import { estimateTokens, formatSubgraph } from "./minimize"
import type { CodeMapProvider } from "./types"

export type BakeTask = {
  id: string
  /** Natural-language or symbol query. */
  query: string
  /** Paths / labels that must appear in a good retrieval. */
  expect: string[]
  hops?: number
}

export type BakeResult = {
  taskID: string
  provider: string
  hitRate: number
  hits: string[]
  misses: string[]
  nodeCount: number
  edgeCount: number
  promptChars: number
  promptTokensEst: number
  latencyMs: number
}

/**
 * Score one retrieval task: fraction of `expect` needles found in serialized subgraph.
 * Used for Graphify vs CRG head-to-head on Prosh (pre-POC §6 / §9).
 */
export async function scoreRetrieval(
  provider: CodeMapProvider,
  task: BakeTask,
): Promise<BakeResult> {
  const started = Date.now()
  const subgraph = await provider.subgraph({ seed: task.query, hops: task.hops ?? 2 })
  const latencyMs = Date.now() - started

  if (!subgraph) {
    return {
      taskID: task.id,
      provider: provider.id,
      hitRate: 0,
      hits: [],
      misses: [...task.expect],
      nodeCount: 0,
      edgeCount: 0,
      promptChars: 0,
      promptTokensEst: 0,
      latencyMs,
    }
  }

  const blob = formatSubgraph(subgraph).toLowerCase()
  const hits = task.expect.filter((needle) => blob.includes(needle.toLowerCase()))
  const misses = task.expect.filter((needle) => !blob.includes(needle.toLowerCase()))
  const prompt = formatSubgraph(subgraph)

  return {
    taskID: task.id,
    provider: provider.id,
    hitRate: task.expect.length === 0 ? 1 : hits.length / task.expect.length,
    hits,
    misses,
    nodeCount: subgraph.nodes.length,
    edgeCount: subgraph.edges.length,
    promptChars: prompt.length,
    promptTokensEst: estimateTokens(prompt),
    latencyMs,
  }
}
