# Usage / Langfuse (Phase 3 scaffold)

Every LLM `step-finish` records tokens + estimated USD via
`packages/opencode/src/grist/usage-log.ts` (hooked from `SessionProcessor`).

## Always on

Structured console lines:

```text
[grist:usage] {"sessionID":"...","provider":"deepseek","model":"deepseek-flash","tokens":{...},"costUsd":0.000123}
```

Disable: `GRIST_USAGE_LOG=off`.

## Langfuse (optional)

Set:

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
# optional self-host:
# export LANGFUSE_BASE_URL=https://your-langfuse.example
```

Grist POSTs a `generation-create` event to Langfuse ingestion (no SDK). Failures
are logged and never fail the agent turn.

Exit for Phase 3: `$/task` visible in console (and Langfuse when keyed).
