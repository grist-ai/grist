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
    excerpt: excerptHead(input.text, EXCERPT_BYTES),
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

/** Test helper */
export function resetSession(sessionID: string) {
  sessions.delete(sessionID)
}
