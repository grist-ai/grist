# Memory (Phase 5 scaffold)

Verified-outcomes-only institutional memory (pre-POC §6).

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
| **Supermemory** (MIT, self-hosted) | `SUPERMEMORY_API_KEY` set | `SUPERMEMORY_BASE_URL` (default `http://localhost:6767`) |
| **File** | no Supermemory key | `.grist/memory.json` or `GRIST_MEMORY_PATH` |
| **Off** | — | `GRIST_MEMORY=off` |

Self-host quickstart: `bunx supermemory local` then `supermemory-server`
([docs](https://supermemory.ai/docs/self-hosting/quickstart)).

## Grist surface

- Algebra: `packages/opencode/src/grist/memory/`
- Tool: `memory` — `action=recall|remember`
- Log: `[grist:memory] …`

## Ownership mining (next)

`scripts/ownership-mine.py` — stub for pydriller → memory remember.
Run against Prosh history once the map layer is locked; feed verified
ownership facts into the same store.

## Tests

```bash
bun run --cwd packages/opencode test src/grist/memory/
```
