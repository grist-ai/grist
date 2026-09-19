import type { Subgraph } from "./types"

/** Serialize a subgraph for prompt injection (context minimization on escalation). */
export function formatSubgraph(subgraph: Subgraph, budgetChars = 4000): string {
  const lines: string[] = [
    `[grist:code-map] seed=${subgraph.seed} hops=${subgraph.hops} nodes=${subgraph.nodes.length} edges=${subgraph.edges.length}`,
    "",
    "## Nodes",
  ]
  for (const node of subgraph.nodes) {
    const loc = node.sourceFile ? ` @ ${node.sourceFile}` : ""
    const kind = node.kind ? ` (${node.kind})` : ""
    lines.push(`- ${node.label}${kind}${loc}`)
  }
  lines.push("", "## Edges")
  for (const edge of subgraph.edges) {
    lines.push(`- ${edge.source} -[${edge.relation}/${edge.confidence}]-> ${edge.target}`)
  }
  const text = lines.join("\n")
  if (text.length <= budgetChars) return text
  return text.slice(0, budgetChars) + `\n...truncated (${text.length} chars → ${budgetChars})...`
}

/** Rough token estimate for bake-off (chars/4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
