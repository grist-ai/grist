#!/usr/bin/env bun
/**
 * grist-automations — the D4 automation runner (operator surface).
 *
 * Automations are named templates that start a thread on a schedule
 * (model: packages/grist-logic/src/automation.ts). The store lives at
 * ~/.local/share/grist/automations.json. This runner is meant to be
 * ticked by cron/launchd (or by hand): `--run-due` starts every due
 * template as a session on the local Grist service, labeled with the
 * automation's id in its session metadata and title. Runs are ordinary
 * threads — they land in the review queue (`--queue`), and nothing
 * they produce merges itself.
 *
 * Usage:
 *   bun script/grist-automations.ts --list
 *   bun script/grist-automations.ts --seed-builtins <project-dir>
 *   bun script/grist-automations.ts --run-due
 *   bun script/grist-automations.ts --queue [--db <path>]
 *   (common: --store <path>, --now <epoch-ms> for testing)
 */
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OpenCode } from "@opencode/client/promise"
import {
  builtinAutomations,
  dueAutomations,
  emptyAutomationStore,
  parseAutomationStore,
  reviewQueue,
  serializeAutomationStore,
  statusFromStoredMessages,
  summaryFromStoredRow,
  threadBranchName,
  type AutomationStore,
} from "../packages/grist-logic/src/index.ts"

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const value = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
const storePath = value("--store") ?? path.join(dataHome, "grist", "automations.json")
const now = value("--now") ? Number(value("--now")) : Date.now()

async function loadStore(): Promise<AutomationStore> {
  if (!existsSync(storePath)) return emptyAutomationStore()
  return parseAutomationStore(await readFile(storePath, "utf8"))
}

async function saveStore(store: AutomationStore) {
  await mkdir(path.dirname(storePath), { recursive: true })
  await writeFile(storePath, serializeAutomationStore(store))
}

const store = await loadStore()

if (flag("--seed-builtins")) {
  const directory = value("--seed-builtins") ?? process.cwd()
  const existing = new Set(store.templates.map((t) => t.id))
  for (const template of builtinAutomations(directory)) {
    if (!existing.has(template.id)) store.templates.push(template)
  }
  await saveStore(store)
  console.log(`Seeded built-ins for ${directory} (${store.templates.length} templates total)`)
  process.exit(0)
}

if (flag("--list") || args.length === 0) {
  if (store.templates.length === 0) {
    console.log("No automations. Seed the built-ins: --seed-builtins <project-dir>")
  }
  for (const t of store.templates) {
    const last = store.lastRunAt[t.id]
    console.log(
      `${t.enabled ? "●" : "○"} ${t.id} — ${t.name} [${t.schedule.kind}] dir=${t.directory} worktree=${t.worktree} last=${last ? new Date(last).toISOString() : "never"}`,
    )
  }
  process.exit(0)
}

if (flag("--run-due")) {
  const due = dueAutomations(store, now)
  if (due.length === 0) {
    console.log("Nothing due.")
    process.exit(0)
  }
  // Attach to the elected local service (the desktop app or `grist
  // serve`). Service.ensure() is deliberately not used: it version-gates
  // the endpoint and respawns the CLI under its upstream name, neither
  // of which fits a runner that should use the service already running.
  const stateHome = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state")
  const registrationPath = path.join(stateHome, "grist", "service-local.json")
  if (!existsSync(registrationPath)) {
    console.error("No local Grist service is registered. Start the desktop app or `grist serve` first.")
    process.exit(1)
  }
  const registration = JSON.parse(await readFile(registrationPath, "utf8")) as { url: string; password: string }
  const auth = "Basic " + Buffer.from(`opencode:${registration.password}`).toString("base64")
  const client = OpenCode.make({
    baseUrl: registration.url,
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        request.headers.set("authorization", auth)
        return fetch(request)
      },
      { preconnect() {} },
    ),
  })
  for (const template of due) {
    let directory = template.directory
    if (template.worktree) {
      const resolved = await client.location.get({ location: { directory: template.directory } })
      const created = await client.worktree.create({
        projectID: resolved.project.id,
        newBranch: threadBranchName({ title: template.name, id: `${template.id}-${now}` }),
      })
      directory = created.directory
    }
    const session = await client.session.create({
      title: template.name,
      location: { directory },
      metadata: { automation: template.id },
    })
    await client.session.prompt({ sessionID: session.id, text: template.prompt })
    store.lastRunAt[template.id] = now
    store.runs.push({ templateID: template.id, sessionID: session.id, startedAt: now })
    console.log(`Started ${template.id} → session ${session.id} in ${directory}`)
  }
  await saveStore(store)
  process.exit(0)
}

if (flag("--queue")) {
  const dbPath = value("--db") ?? (await newestDb())
  const db = new Database(dbPath, { readonly: true })
  const rows = db
    .query(
      "SELECT id, title, directory, project_id, parent_id, fork_session_id, cost, time_updated, time_viewed, time_archived FROM session_v2",
    )
    .all() as Record<string, unknown>[]
  const automationBySession = new Map<string, string>()
  for (const run of store.runs) automationBySession.set(run.sessionID, run.templateID)
  const threads = rows.map((row) => {
    const messages = db
      .query("SELECT type, data FROM session_message WHERE session_id = ? ORDER BY seq")
      .all(row.id as string) as { type: string; data: string }[]
    const parsed = messages.map((m) => {
      try {
        return { type: m.type, data: JSON.parse(m.data) as Record<string, unknown> }
      } catch {
        return { type: m.type }
      }
    })
    const summary = summaryFromStoredRow(
      row as Parameters<typeof summaryFromStoredRow>[0],
      statusFromStoredMessages(parsed),
      0,
      parsed.length,
    )
    return {
      ...summary,
      updatedAt: typeof row.time_updated === "number" ? row.time_updated : undefined,
      viewedAt: typeof row.time_viewed === "number" ? row.time_viewed : undefined,
      archivedAt: typeof row.time_archived === "number" ? row.time_archived : undefined,
    }
  })
  const queue = reviewQueue(threads, { automationBySession })
  if (queue.length === 0) console.log("Review queue is empty.")
  for (const item of queue) {
    console.log(
      `${item.reason.padEnd(11)} ${item.thread.id.slice(0, 18)}  ${item.thread.title ?? "(untitled)"}${item.automationID ? `  [automation: ${item.automationID}]` : ""}`,
    )
  }
  process.exit(0)
}

async function newestDb(): Promise<string> {
  const dir = path.join(dataHome, "grist")
  const files = (await readdir(dir)).filter((f) => f.startsWith("opencode") && f.endsWith(".db"))
  const stats = await Promise.all(files.map(async (f) => ({ f, mtime: (await stat(path.join(dir, f))).mtimeMs })))
  stats.sort((a, b) => b.mtime - a.mtime)
  return path.join(dir, stats[0].f)
}

console.error("Unknown arguments. Use --list, --seed-builtins <dir>, --run-due, or --queue.")
process.exit(1)
