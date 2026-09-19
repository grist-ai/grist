import type { MemoryHit } from "./types"

export function formatHits(input: { query: string; hits: MemoryHit[]; backend: string }): string {
  if (input.hits.length === 0) {
    return `[grist:memory] backend=${input.backend} query=${JSON.stringify(input.query)} hits=0`
  }
  const lines = [
    `[grist:memory] backend=${input.backend} query=${JSON.stringify(input.query)} hits=${input.hits.length}`,
    "",
  ]
  for (const [i, hit] of input.hits.entries()) {
    const meta = [
      hit.outcome ? `outcome=${hit.outcome}` : undefined,
      hit.score !== undefined ? `score=${hit.score.toFixed(3)}` : undefined,
      hit.id ? `id=${hit.id}` : undefined,
    ]
      .filter(Boolean)
      .join(" ")
    lines.push(`${i + 1}. ${meta}`)
    lines.push(hit.content.trim())
    lines.push("")
  }
  return lines.join("\n").trimEnd()
}
