import { createHash } from "node:crypto"
import { sessionAllowsObservationPack } from "./mechanisms"

/** SoL-Pi ObservationPack (pre-POC §5): >10KB full twice, then handle + 1KB excerpt. */
export const PACK_BYTES = 10 * 1024
export const EXCERPT_BYTES = 1024
export const FULL_HITS = 2

const sessions = new Map<string, Map<string, number>>()

export function identity(toolID: string, text: string): string {
  return createHash("sha256").update(toolID).update("\0").update(text).digest("hex").slice(0, 16)
}

export function excerptHead(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text
  let out = ""
  let bytes = 0
  for (const line of text.split("\n")) {
    const size = Buffer.byteLength(line, "utf-8") + (out ? 1 : 0)
    if (bytes + size > maxBytes) break
    out = out ? `${out}\n${line}` : line
    bytes += size
  }
  if (!out) {
    // single long line
    const buf = Buffer.from(text, "utf-8")
    out = buf.subarray(0, maxBytes).toString("utf-8")
  }
  return out
}

export function excerptTail(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text
  const kept: string[] = []
  let bytes = 0
  for (const line of text.split("\n").toReversed()) {
    const size = Buffer.byteLength(line, "utf-8") + (kept.length ? 1 : 0)
    if (bytes + size > maxBytes) break
    kept.push(line)
    bytes += size
  }
  if (kept.length === 0) {
    const buf = Buffer.from(text, "utf-8")
    let start = Math.max(0, buf.length - maxBytes)
    while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
    return buf.subarray(start).toString("utf-8")
  }
  return kept.toReversed().join("\n")
}

/** First ~256 bytes plus tail so build/test errors at the end survive packing. */
export function excerptEnds(text: string, maxBytes: number, headBytes = 256): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text
  const head = excerptHead(text, Math.min(headBytes, maxBytes))
  const sep = "\n...\n"
  const tailBudget = maxBytes - Buffer.byteLength(head, "utf-8") - Buffer.byteLength(sep, "utf-8")
  if (tailBudget <= 0) return excerptHead(text, maxBytes)
  return `${head}${sep}${excerptTail(text, tailBudget)}`
}

export type PackDecision =
  | { action: "passthrough"; count: number }
  | { action: "pack"; handle: string; excerpt: string; count: number }

/**
 * Decide whether to keep full output or pack it.
 * Disabled when GRIST_OBS_PACK=off or session mechanism Choice turns packing off.
 */
export function consider(input: { sessionID: string; toolID: string; text: string }): PackDecision {
  if (process.env.GRIST_OBS_PACK === "off") return { action: "passthrough", count: 0 }
  if (!sessionAllowsObservationPack(input.sessionID)) return { action: "passthrough", count: 0 }
  // Optional cost gate (§5): packing only when output clears a higher bar.
  // Enable with GRIST_MECH_COST_GATE=on (default off — SoL-Pi FULL_HITS already
  // amortizes the first two full deliveries).
  if (process.env.GRIST_MECH_COST_GATE === "on") {
    const minBytes = Number(process.env.GRIST_OBS_PACK_MIN_BYTES ?? String(PACK_BYTES * 2))
    if (Buffer.byteLength(input.text, "utf-8") < minBytes) {
      return { action: "passthrough", count: 0 }
    }
  }
  if (Buffer.byteLength(input.text, "utf-8") <= PACK_BYTES) return { action: "passthrough", count: 0 }

  const handle = identity(input.toolID, input.text)
  let map = sessions.get(input.sessionID)
  if (!map) {
    map = new Map()
    sessions.set(input.sessionID, map)
  }
  const count = (map.get(handle) ?? 0) + 1
  map.set(handle, count)

  if (count <= FULL_HITS) return { action: "passthrough", count }

  return {
    action: "pack",
    handle,
    excerpt: excerptEnds(input.text, EXCERPT_BYTES),
    count,
  }
}

export function formatPacked(input: {
  handle: string
  excerpt: string
  outputPath: string
  toolID: string
  count: number
  totalBytes: number
}): string {
  return [
    `[grist:observation-pack] tool=${input.toolID} handle=${input.handle} hit=${input.count} bytes=${input.totalBytes}`,
    `Full output saved to: ${input.outputPath}`,
    `Use Grep/Read with offset/limit on that path to retrieve more (do not re-run the tool for the same output).`,
    "",
    input.excerpt,
    "",
    `...packed (${input.totalBytes} bytes → ~${EXCERPT_BYTES} byte excerpt after ${FULL_HITS} full deliveries)...`,
  ].join("\n")
}

export function clearObservationPack(sessionID: string) {
  sessions.delete(sessionID)
}

/** Test helper */
export function resetSession(sessionID: string) {
  clearObservationPack(sessionID)
}
