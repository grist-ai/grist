# Grist

Confidence-gated coding agent — a rebranded fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT).
The agent loop *is* this codebase (chat / IDE / CLI / desktop). There is no separate wrapper.

A **Jev confidence gate** routes every task to the **cheapest capable model rung**,
so you get frontier-tier output without paying frontier prices for every step.
**Bring your own key** — Grist never holds your inference budget.

## The model ladder

Four cost-tiered rungs, each the best model in its band. The gate picks per task;
users only ever see rung names, never model identities.

| Rung | Label | When the gate picks it |
| --- | --- | --- |
| `cheapest` | Workhorse | Routine edits, refactors, tests |
| `medium` | Step up | Harder reasoning, multi-file work |
| `frontier` | Frontier | Exception-only: the hardest tasks |
| `premium` | Ultra | Opt-in top tier |

`GRIST_MODE=normal|capped|cheapest` — `capped` keeps frontier off. Disable the gate entirely with `GRIST_GATE=off`.

## Quickstart (BYOK)

```bash
npm install -g grist-ai
grist auth login --provider grist --gateway https://grist.lol
# add your provider key (OpenRouter, Vercel AI Gateway, or any OpenAI-compatible
# endpoint) when prompted — inference bills to YOUR provider account, never to us
cd /path/to/your-repo
grist init
grist bootstrap   # pin SHA + mine code ownership (+ Graphify map if installed)
grist             # start agent
```

`grist init --bootstrap` runs both. Review `.grist/bootstrap/ownership.jsonl`
before persisting any rows to memory.

`grist usage` shows spend by rung. Gate decisions log as `[grist:gate] cheapest|medium|frontier|premium`.

## How it works

- **Jev gate** ([TypeSafe Jev](https://typesafe.ai)): scores task difficulty/confidence
  and routes to the cheapest rung that can handle it. The gate rides *your*
  provider key — no second API dependency, no separate gate key.
- **Code map**: AST graph (Graphify) + a custom tree-sitter rule that extracts
  Express route registrations, so the gate sees the real call graph on hard tasks.
- **Memory**: Supermemory sidecar (self-hosted, MIT) or `.grist/memory.json`;
  ownership mined from your git history via `grist bootstrap`.
- **Mechanisms** (SoL-Pi ports): ObservationPack, Action Fusion, and friends
  compress context on the way in — the gate routes once per run, so cheap steps
  stay cheap. `GRIST_MECH=auto|efficiency|performance|off`.

Value prop: frontier-tier output at your provider's metered cost, with
institutional memory that survives turnover.

## Self-hosting the gateway

The gateway holds the ladder config, the gate, and per-user provider keys
(encrypted at rest, never logged, never returned by any API). `grist_sk_...`
API keys identify the *user*; invite codes are optional onboarding gating.

```bash
bun install
# provider endpoints the gateway may route to are configured server-side;
# each user supplies their own key via `grist auth login` / the dashboard
bun run --cwd packages/opencode src/index.ts gateway
```

See [`docs/`](docs/) for the full spec set: gate, providers, code map, memory,
burn-in evals.

## Developing

```bash
bun install
bun dev   # TUI against packages/opencode
```

Typecheck from package dirs (`bun typecheck`), tests from package dirs
(`bun test` — never from repo root). Conventional commits, no `else`, no
`any`, Bun APIs. Full guide: [`AGENTS.md`](AGENTS.md).

## Upstream

Based on [anomalyco/opencode](https://github.com/anomalyco/opencode). Product
name **Grist**; internal package names stay OpenCode until a deliberate rename.

## License

MIT — see [LICENSE](LICENSE).
