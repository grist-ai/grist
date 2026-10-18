/**
 * R4 Dreaming run (shared-memory spec §15): curate the file-backed memory
 * store — merge dupes, archive stale, supersede retired traps, synthesize
 * recurring-failure patterns — then render the Agent Memory Repo and commit
 * it, so every curation is a Git-audited change. No human in the loop;
 * humans read the commits after the fact.
 *
 * Usage:
 *   bun script/grist-dream.ts [--memory <memory.json>] [--repo <dir>] [--dry-run]
 *
 * Defaults: memory = $GRIST_MEMORY_PATH or ./.grist/memory.json.
 * Restricted-tier records are never touched (hard policy wall).
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { applyDream, planDream } from "../packages/grist-logic/src/memory/dreaming.ts"
import { renderMemoryRepo } from "../packages/grist-logic/src/memory/interchange.ts"
import type { MemoryRecord } from "../packages/grist-logic/src/memory/types.ts"

const run = promisify(execFile)
const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const dryRun = args.includes("--dry-run")
const memoryPath = flag("--memory") ?? process.env.GRIST_MEMORY_PATH ?? path.join(process.cwd(), ".grist", "memory.json")
const repoDir = flag("--repo")

const raw = await readFile(memoryPath, "utf-8").catch(() => "")
const shape = raw ? (JSON.parse(raw) as { records?: MemoryRecord[] }) : { records: [] }
const records = Array.isArray(shape.records) ? shape.records : []

const plan = planDream(records)
console.log(
  `dream: ${records.length} records → merges=${plan.merges.length} archives=${plan.archives.length} contradictions=${plan.contradictions.length} patterns=${plan.patterns.length} restricted-skipped=${plan.skippedRestricted}`,
)
for (const c of plan.contradictions) console.log(`  contradiction flagged: ${c.signature} (${c.ids.length} records kept)`)
if (dryRun) {
  console.log("dry run — nothing written")
  process.exit(0)
}

const curated = applyDream(records, plan)
await mkdir(path.dirname(memoryPath), { recursive: true })
await writeFile(memoryPath, JSON.stringify({ records: curated }, null, 2))
console.log(`store curated: ${records.length} → ${curated.length} records at ${memoryPath}`)

if (repoDir) {
  const namespace = flag("--namespace") ?? curated[0]?.container ?? "default"
  const files = renderMemoryRepo(curated, namespace)
  await mkdir(repoDir, { recursive: true })
  await rm(path.join(repoDir, "memories"), { recursive: true, force: true })
  for (const file of files) {
    const target = path.join(repoDir, file.path)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.text)
  }
  if (!existsSync(path.join(repoDir, ".git"))) {
    await run("git", ["init", "-q"], { cwd: repoDir })
  }
  await run("git", ["add", "-A"], { cwd: repoDir })
  const status = await run("git", ["status", "--porcelain"], { cwd: repoDir })
  if (status.stdout.trim()) {
    const message =
      `dream: ${plan.merges.length} merges, ${plan.archives.length} archives, ${plan.patterns.length} patterns, ${plan.contradictions.length} contradictions flagged` +
      (plan.skippedRestricted ? `, ${plan.skippedRestricted} restricted untouched` : "")
    await run(
      "git",
      ["-c", "user.name=Grist Dreaming", "-c", "user.email=dream@grist.ai", "commit", "-q", "-m", message],
      { cwd: repoDir },
    )
    console.log(`memory repo committed at ${repoDir}: ${message}`)
  } else {
    console.log(`memory repo at ${repoDir}: no changes to commit`)
  }
}
