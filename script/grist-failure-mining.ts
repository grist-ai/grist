/**
 * R3 burn-in mining: misroute table + failure clusters from the burn-in log.
 *
 * Usage: bun script/grist-failure-mining.ts [path-to-burn-in.jsonl]
 * Default path: $GRIST_BURNIN_PATH, else ~/.grist/burn-in.jsonl, else
 * ./.grist/burn-in.jsonl — whichever exists first.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { createBurnInLog } from "../packages/grist-logic/src/burn-in.ts"
import { formatMiningReport } from "../packages/grist-logic/src/failure-mining.ts"

const candidates = [
  process.argv[2],
  process.env.GRIST_BURNIN_PATH,
  path.join(homedir(), ".grist", "burn-in.jsonl"),
  path.join(process.cwd(), ".grist", "burn-in.jsonl"),
].filter((p): p is string => !!p)

const file = candidates.find((p) => existsSync(p))
if (!file) {
  console.error(`no burn-in log found (looked in: ${candidates.join(", ")})`)
  process.exit(1)
}

const events = await createBurnInLog({ filePath: file }).load()
console.log(`# source: ${file} (${events.length} events)\n`)
console.log(formatMiningReport(events))
