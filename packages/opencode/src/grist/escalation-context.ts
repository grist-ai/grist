import { createProvider, formatSubgraph } from "./code-map"
import type { Rung } from "./rung"
import { rankContextNodes } from "./control-plane"
import { gristLog } from "./debug"

/**
 * Context minimization on escalation (pre-POC §4 / §6).
 * When the gate leaves cheapest, inject a code-map subgraph — not the repo.
 * Jev (or shadow) ranks nodes so frontier turns stay short.
 * Disable: `GRIST_CTX_MIN=off`.
 */
export async function escalationContext(input: {
  text: string
  rung: Rung
  cwd?: string
}): Promise<string | undefined> {
  if (process.env.GRIST_CTX_MIN === "off") return undefined
  if (input.rung === "cheapest") return undefined

  const provider = createProvider({ cwd: input.cwd })
  if (!provider) return undefined

  const seed = input.text.trim().slice(0, 240)
  if (!seed) return undefined

  const subgraph = await provider.subgraph({ seed, hops: 2 }).catch(() => undefined)
  if (!subgraph || subgraph.nodes.length === 0) return undefined

  const ranked = await rankContextNodes({ task: input.text, nodes: subgraph.nodes, keep: 12 })
  const trimmed = {
    ...subgraph,
    nodes: ranked,
    edges: subgraph.edges.filter(
      (edge) => ranked.some((n) => n.id === edge.source) && ranked.some((n) => n.id === edge.target),
    ),
  }

  const text = formatSubgraph(trimmed)
  gristLog(
    `[grist:ctx-min] rung=${input.rung} provider=${provider.id} seed=${JSON.stringify(seed.slice(0, 80))} nodes=${trimmed.nodes.length}/${subgraph.nodes.length}`,
  )
  return [
    "# Escalation context (code-map subgraph — do not assume the rest of the repo)",
    text,
  ].join("\n\n")
}
