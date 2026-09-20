# Memory (Phase 5)

Verified-outcomes-only institutional memory (pre-POC §6).

## Is Supermemory open source?

**Yes.** Self-hosted Supermemory local is **MIT**. You can use, modify, and
ship it. The hosted platform / Enterprise extraction models are proprietary;
local runs on **your** LLM key (OpenRouter, Ollama, etc.).

It is **not** an in-process npm library you `import` into Grist. The engine
ships as `supermemory-server` (native binary + local embeddings). Grist treats
it like an LSP: a **managed sidecar** started on demand, not a second terminal
you babysit.

Lite binary note from upstream: licensed up to ~10k documents
(`git.new/memory`).

## Rules

Persist **only** when:
- `tests_passed` — a check the agent ran just passed and the fact is durable
- `user_approved` — the user explicitly confirmed
- `user_corrected` — the user corrected a wrong assumption

Never persist unreviewed generations. Local ranking decays by
`recency × outcome weight` (30-day half-life).

## Backends

| Backend | When | Env |
| --- | --- | --- |
| **Supermemory (managed)** | default — Grist auto-starts local `supermemory-server` if installed | `SUPERMEMORY_BASE_URL` (default `http://127.0.0.1:6767`) |
| **File** | `GRIST_MEMORY=file`, or binary missing / start failed | `.grist/memory.json` or `GRIST_MEMORY_PATH` |
| **Off** | — | `GRIST_MEMORY=off` |

### One-time install

```bash
bunx supermemory local install
# Optional LLM for extraction (OpenRouter as OpenAI-compatible):
# ~/.supermemory/env → OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
```

After that, Grist starts the sidecar itself on first `memory` use
(`[grist:memory] starting supermemory-server…`). Data defaults to
`~/.grist/supermemory`. Disable auto-manage with `GRIST_MEMORY_MANAGE=off`.

Grist remembers via `POST /v3/documents` and recalls via `POST /v4/search`.

## Grist surface

- Algebra: `packages/opencode/src/grist/memory/`
- Managed sidecar: `ensure-local.ts`
- Tool: `memory` — `action=recall|remember`
- Log: `[grist:memory] …`

## Ownership mining

Cold-start:

```bash
grist init /path/to/repo
grist bootstrap /path/to/repo --since 18months
# or: ./scripts/grist-bootstrap.sh /path/to/repo
```

Review `.grist/bootstrap/ownership.jsonl` before `memory remember` — never auto-persist
unreviewed ownership.

## Tests

```bash
bun run --cwd packages/opencode test src/grist/memory/
```
