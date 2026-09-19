# Grist gate (Phase 2 scaffold)

Every user prompt hits `routeTask` in `SessionPrompt.createUserMessage`
(`packages/opencode/src/grist/jev-gate.ts`) before the model is stamped.

- **Live Jev** when `TYPESAFE_API_KEY` is set (`jev-latest` Score difficulty +
  sensitivity, Noul underspecified).
- **Shadow** heuristics otherwise (same compose rules).
- **Compose:** difficulty picks cheapest/medium/frontier; sensitivity caps the
  max rung; underspecified forces **cheapest** (no ask-human rung).
- **Passthrough:** `GRIST_GATE=off`, or explicit user/agent model pin.
- **Doctrine:** `SURGICAL_ENGINEER` appended in `LLMRequestPrep.prepare`.
- **Burn-in:** every decision appends to `.grist/burn-in.jsonl` for calibration
  ([`docs/shadow-burn-in.md`](shadow-burn-in.md)). Thresholds overridable via
  `GRIST_TH_*` env.

Rung → model defaults (override with env):

| Rung | Env | Default (OpenRouter) |
| --- | --- | --- |
| cheapest | `GRIST_CHEAPEST_*` | `openrouter` / `deepseek/deepseek-v4-flash` |
| medium | `GRIST_MEDIUM_*` | `openrouter` / `deepseek/deepseek-v4-pro` |
| frontier | `GRIST_FRONTIER_*` | `openrouter` / `anthropic/claude-opus-4.6` |

One key: `OPENROUTER_API_KEY`. See [`providers.md`](providers.md).

Tests: `bun run --cwd packages/opencode test src/grist/jev-gate.test.ts`
