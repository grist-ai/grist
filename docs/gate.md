# Grist gate (Phase 2 scaffold)

Every user prompt hits `routeTask` in `SessionPrompt.createUserMessage`
(`packages/opencode/src/grist/jev-gate.ts`) before the model is stamped.

- **Live Jev** when `TYPESAFE_API_KEY` is set (`jev-latest` Score difficulty +
  sensitivity, Noul underspecified).
- **Shadow** heuristics otherwise (same compose rules).
- **Compose:** underspecified → `ask_human`; else difficulty picks
  cheapest/medium/frontier, sensitivity caps the max rung.
- **Passthrough:** `GRIST_GATE=off`, or explicit user/agent model pin.
- **Doctrine:** `SURGICAL_ENGINEER` appended in `LLMRequestPrep.prepare`.

Rung → model defaults (override with env):

| Rung | Env | Default |
| --- | --- | --- |
| cheapest | `GRIST_CHEAPEST_*` | `deepseek/deepseek-flash` |
| medium | `GRIST_MEDIUM_*` | `deepseek/deepseek-v4-pro` |
| frontier | `GRIST_FRONTIER_*` | `anthropic/claude-opus-4-20250514` |

`ask_human` keeps the current model and logs the decision (UI handoff later).

Tests: `bun run --cwd packages/opencode test src/grist/jev-gate.test.ts`
