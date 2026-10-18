/**
 * R4 gate calibration: burn-in evidence → threshold suggestions.
 *
 * Usage: bun script/grist-calibrate.ts [burn-in.jsonl] [--out <dir>]
 * Suggestions only — applying them is a config commit a human makes.
 */
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { createBurnInLog } from "../packages/grist-logic/src/burn-in.ts"
import { calibrationEnvFile, formatCalibrationReport, suggestCalibration } from "../packages/grist-logic/src/calibration.ts"
import { loadThresholds } from "../packages/grist-logic/src/thresholds.ts"

const args = process.argv.slice(2)
const outAt = args.indexOf("--out")
const outDir = outAt >= 0 ? args[outAt + 1] : undefined
const positional = args.filter((a, i) => !a.startsWith("--") && i !== outAt + 1)

const candidates = [
  positional[0],
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
const result = suggestCalibration(events, loadThresholds())
console.log(`# source: ${file} (${events.length} events)\n`)
console.log(formatCalibrationReport(result))

if (outDir && result.suggestions.length) {
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, "thresholds.env"), calibrationEnvFile(result))
  await writeFile(path.join(outDir, "calibration.md"), formatCalibrationReport(result))
  console.log(`wrote ${outDir}/thresholds.env + calibration.md — review and commit to apply`)
}
