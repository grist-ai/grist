# Providers (Phase 1 harness)

Testers never hold a model key. The **gateway** has one `OPENROUTER_API_KEY`
(the founder's) and routes cheapest → medium → frontier by model id.
Subscription billing replaces invites later; until then every completion is
founder credits, capped per invite code.

See [`grist-public-launch-spec.md`](grist-public-launch-spec.md).

## Testers

```bash
grist auth login --provider grist
# or a dashboard key: grist auth login --provider grist --api-key grist_sk_…
grist usage
grist
```

Invite or `grist_sk_...` is stored in `~/.grist/config.json` (0600). `GRIST_API_KEY` /
`GRIST_INVITE` / `GRIST_GATEWAY_URL` override the file. No `OPENROUTER_API_KEY`
on the client.

## Founder gateway

```bash
export OPENROUTER_API_KEY=sk-or-v1-...   # this process only
export TYPESAFE_API_KEY=...              # optional live Jev
export GRIST_ADMIN_TOKEN=...
grist gateway                            # :8787 — mint codes at /admin as pranavmm25@gmail.com
```

Ladder ids (override with `GRIST_*_MODEL` **on the gateway**):

| Rung | OpenRouter model id | Env override |
| --- | --- | --- |
| Cheapest | `deepseek/deepseek-v4.1-flash` | `GRIST_CHEAPEST_MODEL` |
| Medium | `moonshotai/kimi-k3` | `GRIST_MEDIUM_MODEL` |
| Frontier | `openai/gpt-5.6-sol` | `GRIST_FRONTIER_MODEL` |

### Ladder pricing (OpenRouter, 2026-09-19)

Verify live on [openrouter.ai/models](https://openrouter.ai/models). DeepSeek
first-party Flash also has peak windows — see
[api-docs.deepseek.com](https://api-docs.deepseek.com/quick_start/pricing).

| Model | In/out per 1M tok | Notes |
| --- | --- | --- |
| `deepseek/deepseek-v4.1-flash` | $0.15 / $0.60 off-peak (peak 2×) | Cheap default; first-party `deepseek-flash` |
| `moonshotai/kimi-k3` | ~$1.70 / $8.50 floor | Medium default |
| `openai/gpt-5.6-sol` | $4 / $20 list; OpenRouter 50% off ≈ $2 / $10 | Frontier default |

Peak windows for DeepSeek (UTC weekdays): 01:00–04:00 and 06:00–10:00. US daytime ≈ off-peak.

Swap a rung without a client update, e.g. frontier to Claude:

```bash
export GRIST_FRONTIER_MODEL=anthropic/claude-opus-4.6
```

## Operating mode (gateway)

```bash
export GRIST_MODE=capped      # frontier off; medium is top
# export GRIST_MODE=cheapest  # cheapest-only
# or POST /v1/admin/mode
```

See [`gate.md`](gate.md).
