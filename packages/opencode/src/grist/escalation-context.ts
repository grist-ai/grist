import { createProvider, formatSubgraph } from "./code-map"
import type { Rung } from "./rung"

/**
 * Context minimization on escalation (pre-POC §4 / §6).
 * When the gate leaves cheapest, inject a code-map subgraph — not the repo.
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

  const text = formatSubgraph(subgraph)
  console.log(
    `[grist:ctx-min] rung=${input.rung} provider=${provider.id} seed=${JSON.stringify(seed.slice(0, 80))} nodes=${subgraph.nodes.length}`,
  )
  return [
    "# Escalation context (code-map subgraph — do not assume the rest of the repo)",
    text,
  ].join("\n\n")
}
