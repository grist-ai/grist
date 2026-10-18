/**
 * D2 worktree hygiene: plan (and optionally apply) stale-worktree cleanup
 * against the local runtime database.
 *
 * The plan is computed by grist-logic's `planWorktreeCleanup` from the
 * stored thread projection (`session_v2`) and the engine's worktree
 * inventory (`worktree` table): a worktree is stale when every thread
 * that ran in it is archived. Only inventory rows with a recorded
 * strategy (worktrees the engine created) can ever be planned — a
 * checkout Grist did not create is never touched.
 *
 * Default is a dry run. With `--apply`, each planned worktree is removed
 * with `git worktree remove` (never `--force`: a dirty worktree is
 * reported and left in place for the Settings → Workspaces flow). The
 * server reconciles its inventory on the next refresh.
 *
 * Usage:
 *   bun script/grist-worktrees.ts [--db <opencode.db>] [--apply] [--include-orphans]
 */
import { Database } from "bun:sqlite"
import { readdir, stat } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import {
  planWorktreeCleanup,
  type ProjectWorktrees,
  type ThreadWorktreeRef,
} from "../packages/grist-logic/src/worktree.ts"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string) => args.includes(name)

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
const apply = has("--apply")
const db = apply ? new Database(dbPath) : new Database(dbPath, { readonly: true })

const threads = db
  .query("SELECT id, directory, project_id, time_archived FROM session_v2")
  .all() as { id: string; directory: string; project_id: string; time_archived: number | null }[]
const threadRefs: ThreadWorktreeRef[] = threads.map((row) => ({
  id: row.id,
  directory: row.directory,
  projectID: row.project_id,
  archivedAt: row.time_archived ?? undefined,
}))

const inventory = db
  .query("SELECT project_id, directory, strategy FROM worktree")
  .all() as { project_id: string; directory: string; strategy: string | null }[]
const byProject = new Map<string, ProjectWorktrees>()
for (const row of inventory) {
  const project = byProject.get(row.project_id) ?? { projectID: row.project_id, entries: [] }
  ;(project.entries as { directory: string; strategy?: string }[]).push({
    directory: row.directory,
    strategy: row.strategy ?? undefined,
  })
  byProject.set(row.project_id, project)
}
const projects = [...byProject.values()]

const roots = new Map(
  (db.query("SELECT id, worktree FROM project").all() as { id: string; worktree: string }[]).map((row) => [
    row.id,
    row.worktree,
  ]),
)

const plan = planWorktreeCleanup(threadRefs, projects, { includeOrphans: has("--include-orphans") })

console.log(`db: ${dbPath}`)
console.log(`threads: ${threadRefs.length}, projects with inventory: ${projects.length}`)
if (plan.length === 0) {
  console.log("cleanup plan: nothing stale")
  process.exit(0)
}
console.log(`cleanup plan (${plan.length}):`)
for (const item of plan) console.log(`  [${item.reason}] ${item.directory} (project ${item.projectID})`)

if (!apply) {
  console.log("dry run — pass --apply to remove these worktrees (git worktree remove, never forced)")
  process.exit(0)
}

let failed = 0
for (const item of plan) {
  const root = roots.get(item.projectID)
  if (!root) {
    console.log(`skip ${item.directory}: project root unknown`)
    failed++
    continue
  }
  const result = spawnSync("git", ["-C", root, "worktree", "remove", item.directory], { encoding: "utf8" })
  if (result.status === 0) {
    db.query("DELETE FROM worktree WHERE project_id = ? AND directory = ?").run(item.projectID, item.directory)
    console.log(`removed ${item.directory}`)
  } else {
    failed++
    console.log(`left in place ${item.directory}: ${(result.stderr || result.stdout).trim()}`)
  }
}
console.log(failed === 0 ? "cleanup applied" : `cleanup applied with ${failed} left in place`)
process.exit(failed === 0 ? 0 : 1)
