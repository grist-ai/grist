import type { MemoryRecord, OutcomeKind, RememberInput } from "./types.js"

/**
 * Agent Memory Repo interchange (shared-memory spec §15).
 *
 * A namespace renders as a plain Git-friendly tree:
 *
 *   MEMORY.md            index: one line per record with a [[path]] link and
 *                        `[source: <session-id>; added: YYYY-MM-DD]` metadata
 *   memories/<id>.md     one file per record: header lines (outcome,
 *                        container, weight, created) then the content
 *
 * Import parses the same layout back into RememberInput rows. Records whose
 * outcome header is missing or unverifiable come back flagged
 * (`verified: false`) — the store's verified-outcomes gate still decides
 * admission; import never bypasses it.
 */

export type MemoryRepoFile = { path: string; text: string }

export type ImportedMemory = RememberInput & { verified: boolean }

const HEADER_KEYS = ["outcome", "container", "weight", "created", "session"] as const

export function renderMemoryRepo(records: MemoryRecord[], namespace: string): MemoryRepoFile[] {
  const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt)
  const index: string[] = [
    `# Memory — ${namespace}`,
    "",
    "Agent Memory Repo export (Grist). One file per verified memory;",
    "see the shared-memory spec §15 for the format.",
    "",
  ]
  const files: MemoryRepoFile[] = []
  for (const record of sorted) {
    const rel = `memories/${record.id}.md`
    const firstLine = record.content.trim().split("\n")[0]?.slice(0, 120) ?? ""
    const added = new Date(record.createdAt).toISOString().slice(0, 10)
    const source = record.sessionID ?? "unknown"
    index.push(`- [[${rel}]] ${firstLine} [source: ${source}; added: ${added}]`)
    const header = [
      `outcome: ${record.outcome}`,
      `container: ${record.container}`,
      `weight: ${record.weight}`,
      `created: ${new Date(record.createdAt).toISOString()}`,
      ...(record.sessionID ? [`session: ${record.sessionID}`] : []),
      ...(record.metadata
        ? Object.entries(record.metadata).map(([k, v]) => `meta.${k}: ${v}`)
        : []),
    ]
    files.push({ path: rel, text: `${header.join("\n")}\n\n${record.content.trim()}\n` })
  }
  return [{ path: "MEMORY.md", text: `${index.join("\n")}\n` }, ...files]
}

export function parseMemoryRepo(files: MemoryRepoFile[]): ImportedMemory[] {
  const byPath = new Map(files.map((f) => [f.path, f.text]))
  const index = byPath.get("MEMORY.md")
  if (!index) return []
  const out: ImportedMemory[] = []
  for (const match of index.matchAll(/\[\[(memories\/[^\]]+)\]\]/g)) {
    const rel = match[1]
    if (!rel) continue
    const text = byPath.get(rel)
    if (!text) continue
    const parsed = parseRecordFile(text)
    if (!parsed) continue
    out.push(parsed)
  }
  return out
}

function parseRecordFile(text: string): ImportedMemory | undefined {
  const splitAt = text.indexOf("\n\n")
  if (splitAt < 0) return undefined
  const headerText = text.slice(0, splitAt)
  const content = text.slice(splitAt + 2).trim()
  if (!content) return undefined
  const header = new Map<string, string>()
  for (const line of headerText.split("\n")) {
    const at = line.indexOf(":")
    if (at < 0) continue
    header.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  const container = header.get("container") ?? ""
  if (!container) return undefined
  const outcomeRaw = header.get("outcome")
  const outcome = isOutcome(outcomeRaw) ? outcomeRaw : undefined
  const metadata: Record<string, string> = {}
  for (const [key, value] of header) {
    if (key.startsWith("meta.")) metadata[key.slice(5)] = value
  }
  const weightRaw = Number(header.get("weight"))
  return {
    content,
    container,
    // Unverifiable imports enter flagged: outcome is only trusted when the
    // header carries one of the verified kinds (§15).
    outcome: (outcome ?? "user_approved") as OutcomeKind,
    verified: outcome !== undefined,
    sessionID: header.get("session"),
    weight: Number.isFinite(weightRaw) && weightRaw > 0 ? weightRaw : undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined,
  }
}

function isOutcome(value: string | undefined): value is OutcomeKind {
  return value === "tests_passed" || value === "user_approved" || value === "user_corrected"
}

export { HEADER_KEYS }
