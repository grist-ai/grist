/**
 * D0 live projection: read the local runtime database and project stored
 * sessions into THREADS (the supervision view D1 renders). Read-only.
 *
 * Finding behind this script: the current build does not retain the raw
 * durable event log (the `event` table is empty in the live db) — events
 * are projected into `session_v2` + `session_message`. The thread model
 * therefore has two sources with one output shape: live events
 * (`itemFromSessionEvent`) and stored rows (used here).
 *
 * Usage:
 *   bun script/grist-threads.ts [--db <opencode.db>] [--show <sessionID>]
 *
 * Default db: the most recently modified opencode*.db under
 * ~/.local/share/grist.
 */
import { Database } from "bun:sqlite"
import { readdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  itemsFromStoredMessages,
  orderThreads,
  statusFromStoredMessages,
  summaryFromStoredRow,
  type StoredMessage,
  type StoredSessionRow,
} from "../packages/grist-logic/src/thread-model.ts"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function defaultDb(): Promise<string> {
  const dir = path.join(os.homedir(), ".local", "share", "grist")
  const names = (await readdir(dir)).filter((n) => n.startsWith("opencode") && n.endsWith(".db"))
  let best: { path: string; mtime: number } | undefined
  for (const name of names) {
    const p = path.join(dir, name)
    const s = await stat(p)
    if (!best || s.mtimeMs > best.mtime) best = { path: p, mtime: s.mtimeMs }
  }
  if (!best) throw new Error(`no opencode*.db under ${dir}`)
  return best.path
}

const dbPath = flag("--db") ?? (await defaultDb())
const db = new Database(dbPath, { readonly: true })

const sessions = db
  .query("SELECT id, title, directory, project_id, parent_id, fork_session_id, cost FROM session_v2 ORDER BY id")
  .all() as StoredSessionRow[]

const projected = sessions.map((row) => {
  const rows = db
    .query("SELECT type, data FROM session_message WHERE session_id = ? ORDER BY seq")
    .all(row.id) as { type: string; data: string }[]
  const messages: StoredMessage[] = rows.map((r) => {
    try {
      return { type: r.type, data: JSON.parse(r.data) as Record<string, unknown> }
    } catch {
      return { type: r.type, data: {} }
    }
  })
  const items = itemsFromStoredMessages(messages)
  const stepCount = items.filter((i) => i.kind === "step").length
  const summary = summaryFromStoredRow(row, statusFromStoredMessages(messages), stepCount, items.length)
  return { summary, items, lastSeq: rows.length }
})

const ordered = orderThreads(projected)
console.log(`db: ${dbPath}`)
console.log(`threads: ${ordered.length}`)
for (const t of ordered.slice(0, 15)) {
  const s = t.summary
  console.log(
    `${s.id.slice(0, 18)}  ${s.status.padEnd(11)} steps=${String(s.stepCount).padStart(3)} items=${String(s.itemCount).padStart(4)} $${s.totalCost.toFixed(4)}  ${s.title ?? "(untitled)"}  [${s.directory ?? "?"}]`,
  )
}

const showID = flag("--show") ?? ordered.find((t) => t.summary.itemCount > 0)?.summary.id
const show = projected.find((t) => t.summary.id === showID)
if (show) {
  const kinds = new Map<string, number>()
  for (const item of show.items) kinds.set(item.kind, (kinds.get(item.kind) ?? 0) + 1)
  console.log(`\nsample thread ${show.summary.id}: item kinds = ${JSON.stringify(Object.fromEntries(kinds))}`)
}
