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

## Ownership mining

```bash
python3 scripts/ownership-mine.py --repo /path/to/Prosh --since 18months \
  --out .grist/bootstrap/ownership.jsonl
```

Uses `git log` today (pydriller path reserved until license confirmation).
Review rows before `memory remember` — never auto-persist unreviewed ownership.

Cold-start wrapper (pin SHA → optional Graphify → ownership mine):

```bash
./scripts/grist-bootstrap.sh /path/to/Prosh
```

## Tests

```bash
bun run --cwd packages/opencode test src/grist/memory/
```
