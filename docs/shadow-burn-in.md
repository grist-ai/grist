# Shadow burn-in (Phase 6 scaffold)

Calibrate gate thresholds on real tasks (pre-POC §8.6 / §9). Exit: measured
tier mix (≥80% cheapest / ≤5% frontier) + escalation precision from
counterfactuals.

## What gets logged

Every `routeTask` decision appends a JSONL row to
`.grist/burn-in.jsonl` (or `GRIST_BURNIN_PATH`):

```json
{"kind":"decision","rung":"cheapest","difficulty":0.2,...}
```

Label outcomes later (manual or harness hook):

```ts
await createBurnInLog().recordOutcome({
  decisionID,
  outcome: "success", // or fail | escalated
  cheaperWouldSucceed: false, // counterfactual for escalations
})
```

Disable: `GRIST_BURNIN=off`.

## Calibrated thresholds

Defaults live in `packages/opencode/src/grist/thresholds.ts`. After burn-in,
override via env (no code change):

| Env | Meaning | Default |
| --- | --- | --- |
| `GRIST_TH_DIFF_MEDIUM` | difficulty → medium | 0.4 |
| `GRIST_TH_DIFF_FRONTIER` | difficulty → frontier | 0.75 |
| `GRIST_TH_UNDER_CHEAPEST` | underspecified → cheapest | 0.7 |
| `GRIST_TH_SENS_CHEAPEST` | sensitivity cap cheapest | 0.75 |
| `GRIST_TH_SENS_MEDIUM` | sensitivity cap medium | 0.45 |

## Report

```bash
bun scripts/burn-in-report.ts
```

Prints tier mix, success rate, escalation precision proxy, and whether
≥80% / ≤5% targets are met (exit 2 if not, when there is data).

## Tests

```bash
bun run --cwd packages/opencode test src/grist/burn-in.test.ts
```
