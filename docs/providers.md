# Providers (Phase 1 harness)

Grist holds API keys and points the OpenCode fork at the model ladder.
Default rung: **DeepSeek Flash** (`deepseek-flash`).

## DeepSeek (required for Phase 1)

1. Create a key at [platform.deepseek.com](https://platform.deepseek.com).
2. Export it (or put it in a local `.env` that is **not** committed):

```bash
export DEEPSEEK_API_KEY=sk-...
```

3. Project config (gitignored `opencode.jsonc` — copy from example):

```bash
cp opencode.jsonc.example opencode.jsonc
```

4. Connect / verify:

```bash
bun run --cwd packages/opencode src/index.ts models deepseek
# or interactive: bun dev  then /connect deepseek
```

OpenAI-compatible base URL: `https://api.deepseek.com`. Recheck pricing at
[api-docs.deepseek.com](https://api-docs.deepseek.com) before locking economics.

### Medium / frontier (later phases)

| Rung | Model (spec) | Notes |
| --- | --- | --- |
| Cheapest | `deepseek-flash` | Phase 1 default |
| Medium | DeepSeek V4 Pro | Confirm live API id at build time (may route/retire) |
| Frontier | Claude Opus 5 (backup GPT-5.6 Sol) | Anthropic / OpenAI keys; Phase 2+ with Jev |

Router stays provider-agnostic — backup cheap tier (Kimi / GPT-mini class) must
be one config change away.

## TypeSafe / Jev (Phase 2)

```bash
export TYPESAFE_API_KEY=...
```

See [`grist-pre-poc-spec-sheet.md`](grist-pre-poc-spec-sheet.md) §4.
