#!/usr/bin/env bun
/**
 * Print shadow burn-in summary from `.grist/burn-in.jsonl`.
 *
 *   bun scripts/burn-in-report.ts
 *   GRIST_BURNIN_PATH=/path/to/log.jsonl bun scripts/burn-in-report.ts
 */
import { createBurnInLog } from "../packages/opencode/src/grist/burn-in.ts"

const log = createBurnInLog()
const { summary, targets, path } = await log.report()

console.log(`[grist:burn-in] path=${path}`)
console.log(
  JSON.stringify(
    {
      decisions: summary.decisions,
      byRung: summary.byRung,
      tierMix: {
        cheapest: Number(summary.tierMix.cheapest.toFixed(3)),
        medium: Number(summary.tierMix.medium.toFixed(3)),
        frontier: Number(summary.tierMix.frontier.toFixed(3)),
      },
      outcomes: summary.outcomes,
      successRate: Number(summary.successRate.toFixed(3)),
      cheapestSuccessShare: Number(summary.cheapestSuccessShare.toFixed(3)),
      escalationPrecision: summary.escalationPrecision,
      targetsMet: targets.ok,
      targetGaps: targets.reasons,
    },
    null,
    2,
  ),
)

if (!targets.ok && summary.decisions > 0) process.exitCode = 2
