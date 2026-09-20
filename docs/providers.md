# Providers (Phase 1 harness)

Grist holds **one** API key via [OpenRouter](https://openrouter.ai) and routes
the model ladder (cheapest → medium → frontier) by changing model ids only.

## OpenRouter (recommended)

1. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. Export it (or put it in a local `.env` that is **not** committed):

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
```

Or put it in a local **`.env`** (gitignored; Bun loads it automatically):

```bash
cp .env.example .env
# edit .env → OPENROUTER_API_KEY=sk-or-v1-...
```

3. Project config:

```bash
cp opencode.jsonc.example opencode.jsonc
```

Default model: `openrouter/deepseek/deepseek-v4.1-flash`.

4. Verify:

```bash
bun run --cwd packages/opencode src/index.ts models openrouter
# or: bun dev  then /connect openrouter
```

### Ladder (defaults — all via OpenRouter)

| Rung | OpenRouter model id | Env override |
| --- | --- | --- |
| Cheapest | `deepseek/deepseek-v4.1-flash` | `GRIST_CHEAPEST_MODEL` |
| Medium | `deepseek/deepseek-v4-pro` | `GRIST_MEDIUM_MODEL` |
| Frontier | `anthropic/claude-opus-4.6` | `GRIST_FRONTIER_MODEL` |

### DeepSeek pricing recheck (2026-09-19)

First-party [api-docs.deepseek.com](https://api-docs.deepseek.com/quick_start/pricing)
(off-peak / peak per 1M tok). OpenRouter markups may differ — verify on
[openrouter.ai/models](https://openrouter.ai/models).

| Model | Off-peak in/out | Peak in/out | Notes |
| --- | --- | --- | --- |
| `deepseek-flash` (V4.1-Flash) | $0.15 / $0.60 | $0.30 / $1.20 | Preferred cheap; legacy `deepseek-v4-flash` aliases here |
| `deepseek-v4-pro` (0813) | $0.66 / $1.98 | $1.32 / $3.96 | Still served after 2026-09-14; was nearly withdrawn |

Peak windows (UTC weekdays): 01:00–04:00 and 06:00–10:00. US daytime ≈ off-peak.
Spec sheet table (~$0.44/$0.87 promo for Pro) is **stale** — use this row for economics.

Provider defaults to `openrouter` for every rung (`GRIST_*_PROVIDER` to pin
elsewhere). Example — swap frontier to GPT-5.6 Sol still on OpenRouter:

```bash
export GRIST_FRONTIER_MODEL=openai/gpt-5.6-sol
```

Browse live ids: [openrouter.ai/models](https://openrouter.ai/models).

## Backup cheap tier

DeepSeek concentration risk: keep a second cheap model one env change away, e.g.

```bash
export GRIST_CHEAPEST_MODEL=moonshotai/kimi-k2.5   # or openai/gpt-4o-mini-class id
```

Still one `OPENROUTER_API_KEY` — no new provider key.

## Operating mode

```bash
export GRIST_MODE=capped      # frontier off; medium is top
# export GRIST_MODE=cheapest  # cheapest-only
```

See [`gate.md`](gate.md).

## Native providers (optional)

You can still use first-party keys if you prefer (DeepSeek / Anthropic /
OpenAI). Set `GRIST_*_PROVIDER` + `GRIST_*_MODEL` accordingly and export that
provider’s key. OpenRouter remains the zero-friction default.

## TypeSafe / Jev (Phase 2)

```bash
export TYPESAFE_API_KEY=...
```

See [`grist-pre-poc-spec-sheet.md`](grist-pre-poc-spec-sheet.md) §4.
Gate: [`gate.md`](gate.md).
