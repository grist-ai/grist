#!/usr/bin/env bun
/**
 * In-repo Grist eval — no external pilot repo.
 *
 *   bun scripts/grist-eval.ts
 */
import { runGateBattery, suggestThresholds } from "../packages/opencode/src/grist/eval/battery.ts"
import { createBurnInLog } from "../packages/opencode/src/grist/burn-in.ts"

const battery = runGateBattery()
console.log("[grist:eval] gate battery")
console.log(
  JSON.stringify(
    {
      pass: battery.pass,
      total: battery.total,
      ok: battery.ok,
      results: battery.results,
    },
    null,
    2,
  ),
)

const { summary, targets, path } = await createBurnInLog().report()
const suggested = suggestThresholds(summary)
console.log(`[grist:eval] burn-in path=${path}`)
console.log(
  JSON.stringify(
    {
      decisions: summary.decisions,
      tierMix: summary.tierMix,
      targetsMet: targets.ok,
      targetGaps: targets.reasons,
      suggestedThresholds: suggested,
    },
    null,
    2,
  ),
)

if (!battery.ok) process.exitCode = 1
if (!targets.ok && summary.decisions > 0) process.exitCode = 2
