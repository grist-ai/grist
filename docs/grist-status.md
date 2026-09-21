# Grist build status (in-tree)

Grist pre-POC phases **1–6 are implemented in this fork**. Pilot-repo exits
(Prosh bake-off / burn-in) are **out of scope until Grist itself is run** —
do not block harness work on an external codebase.

## Done in-tree

| Area | Surface |
| --- | --- |
| Harness / ladder | OpenRouter + `GRIST_*_MODEL` ([providers.md](providers.md)) |
| Public test | Invite gateway + `grist auth login` ([grist-public-launch-spec.md](grist-public-launch-spec.md)) |
| Gate | Jev + shadow ([gate.md](gate.md)) |
| Control plane | continue/stop/escalate, permission, tool budget, verify, ctx rank (`GRIST_CTRL`) |
| Operating modes | `GRIST_MODE` |
| SoL-Pi | ObservationPack, Action Fusion, mechanism Choice ([solpi.md](solpi.md)) |
| Escalation context | code-map subgraph on medium/frontier (`GRIST_CTX_MIN`) |
| Doctrine | surgical-engineer + multi-file plan; diff audit on edit/write |
| Usage | `[grist:usage]` + Langfuse; `[grist:event]` for mode-cap / diff-audit |
| Code map | Graphify / CRG algebra + `code_map` tool |
| Memory | verified-outcomes file / Supermemory + `memory` tool |
| Burn-in | JSONL + thresholds + report |
| Eval | `bun scripts/grist-eval.ts` — gate battery + threshold suggestions |

## Run Grist (no pilot repo)

```bash
# Founder gateway (your OpenRouter key lives here only)
export OPENROUTER_API_KEY=sk-or-v1-...
export GRIST_ADMIN_TOKEN=dev
bun run --cwd packages/opencode src/index.ts gateway
# Then: grist auth login --provider grist --gateway http://127.0.0.1:8787
bun run --cwd packages/opencode test src/grist/
bun scripts/grist-eval.ts
bun scripts/burn-in-report.ts
bun dev
```

## Later (pilot — not required to finish Grist)

- Map bake-off and memory bootstrap against a real team repo
- Multi-week shadow burn-in for calibrated `GRIST_TH_*`
- Jev live key (shadow gate works without it)
