<p align="center">
  <strong>Grist</strong>
</p>

<p align="center">
  <strong>A complete coding-agent harness.</strong><br />
  Confidence-gated model routing, doctrine-driven sessions, and BYOK economics —
  frontier-tier output at metered cost.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/grist-ai"><img src="https://img.shields.io/npm/v/grist-ai" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/BYOK-your%20key%2C%20zero%20markup-blue" alt="BYOK" />
</p>

```bash
npm install -g grist-ai
```

Grist is a coding-agent harness built on [OpenCode v2](https://github.com/anomalyco/opencode)
(MIT). The agent loop *is* the upstream codebase — Grist ships as a first-class
OpenCode plugin (`@grist-ai/plugin`) baked into the `grist` binary, so every
session loads the Jev confidence gate, the doctrine injector, and the
control-plane hooks with zero user config.

What makes it different is what's wrapped around that loop: a **Jev confidence
gate** that routes every task to the cheapest capable model rung; **doctrine**
injected into session context; **escalate-only model switching** mid-run;
**BYOK economics** — inference bills to your provider account (OpenRouter,
Vercel AI Gateway, or any OpenAI-compatible endpoint) with zero markup. Grist
never holds your inference budget.

## New in v2

Grist moved from a surgical fork of OpenCode v1 to a first-class OpenCode v2
plugin (now tracking upstream v2.0.18). What changed:

- **Zero-config plugin** — `@grist-ai/plugin` is baked into the `grist`
  binary. Every session loads the Jev gate, doctrine injector, and control
  plane with no user setup. The only upstream edit is one additive registry
  function, so future upstream releases merge as plain tags — no fork diff
  to carry.
- **Full CLI surface** — the v2 move brings the whole OpenCode command set:
  `grist auth`, `grist models`, `grist debug`, `grist service`,
  `grist upgrade`, `grist stats`, `grist session`, `grist mcp`, `grist pair`,
  `grist reload`, and `grist serve` (API + web UI). The utility commands
  arrive as upstream features, not Grist code.
- **Managed background service** — `grist serve --service` elects a single
  server; `grist run` is a thin client over it. No more ad-hoc servers.
- **Grist identity** — config discovery prefers `grist.json`/`grist.jsonc`
  and `.grist/`, and global state lives under `~/.grist`, `~/.config/grist`,
  `~/.cache/grist`, `~/.local/state/grist`, and `~/.local/share/grist`.

## What's new

Recent improvements to the harness:

- **Specialist subagents** — the gate now delegates to named specialists
  (`grist-explore`, `grist-plan`, `grist-review`, `grist-verify`) that run
  *within* the assigned rung. Decomposition happens inside the rung, so
  subagents can only shed cost, never gain it. Each specialist ships with
  doctrine for its role.
- **Effort dial** — within a rung, the gate dials exploratory effort
  (`low` / `standard` / `high`) from the Jev confidence score: trivial tasks
  get a tight exploration budget, ambiguous ones get room to investigate.
  Set `GRIST_EFFORT` to pin it, or let the gate decide.
- **Warm subagent resume** — repeat subagent calls resume the previous
  session instead of starting cold, so context compounds across calls
  (cap 3 resumes per parent session; `GRIST_WARM_SUBAGENTS=0` to disable).
- **Honest spend metering** — the gateway bills from the provider's own
  reported cost when available, and cached tokens are priced at cached
  rates. What your dashboard shows is what your provider charged.
- **`grist doctor`** now validates your gateway credential with a live
  authenticated call, not just a presence check.

## The ladder

Four cost-tiered rungs. The gate picks per task — never pin one with `-m`
unless you're deliberately testing.

| Rung | Model | Input / 1M | Output / 1M |
| --- | --- | --- | --- |
| `cheapest` | `deepseek/deepseek-v4.1-flash` | $0.14 | $0.42 |
| `medium` | `moonshotai/kimi-k3` | $3.00 | $15.00 |
| `frontier` | `openai/gpt-6-sol` | $2.00 | $10.00 |
| `premium` | `anthropic/claude-opus-5.5` | $4.00 | $20.00 |

Prices snapshotted from OpenRouter and checked into
[`packages/grist-gateway/src/model-prices.ts`](packages/grist-gateway/src/model-prices.ts).
Upstream model identities never ship in the client — the client speaks rung
names only; the gateway resolves them.

## Benchmarks

Internal Pareto benchmark (Sep 2026): 49 coding tasks across 6 routing
configs, 294 runs. The confidence gate solved every task — routing simple
work to `cheapest`, harder multi-file work to `medium` — and never needed
`frontier`.

| | Gate (cheapest → medium) | Raw frontier rung |
|---|---|---|
| Single-file tasks (35) | 100% solved · $0.0064/solved task | 29% solved · $0.1513/solved task |
| Multi-file tasks (14) | 100% solved · $0.0067/solved task | 100% solved · $0.4202/solved task |

Raw frontier only matches the gate's accuracy by dispatching ~11 subagents
per task — the cost structure the gate exists to avoid.

Full methodology, configs, and limitations: [`docs/benchmarks.md`](docs/benchmarks.md).
Repro bundle: [`benchmarks/`](benchmarks/).

## Quickstart (BYOK)

```bash
npm install -g grist-ai

# Sign in (opens your browser; account is created on the spot):
grist auth login --provider grist

# …or headless: export GRIST_API_KEY (a grist_sk_… key from the dashboard),
# or put the key + gateway URL in ~/.grist/config.json.
export GRIST_API_KEY="grist_sk_…"
export GRIST_GATEWAY_URL="https://grist.lol"  # default; override for self-hosted

cd /path/to/your-repo
grist run "Add a retry with backoff to the webhook sender, with tests." < /dev/null
```

Headless notes: there is no `--dir` flag — `cd` into the checkout first. Each
stdout line with `--format json` is one event (`sessionID` on the first);
resume with `grist run --session <id>`. `< /dev/null` matters: `grist run`
waits for stdin EOF even with a message argument.

Check spend any time:

```bash
curl -s -H "X-Grist-Api-Key: $GRIST_API_KEY" "$GRIST_GATEWAY_URL/v1/usage"
```

## How it works

```
┌──────────┐  task            ┌──────────────┐  grist_sk auth   ┌──────────┐
│ grist    │ ───────────────▶ │ @grist-ai/   │ ───────────────▶ │ Jev gate │
│ (v2 CLI  │                  │ gateway      │  cap check (402) │  1×/run  │
│ +plugin) │                  │              │                  └────┬─────┘
└──────────┘                  └──────┬───────┘                       │ rung
                                     │ rung                         ▼
                                     ▼                        ┌──────────────┐
                              ┌────────────┐   model id       │  Provider    │
                              │  Ladder    │ ───────────────▶ │  (your key)  │
                              │ rung→model │                  └──────────────┘
                              └────────────┘
```

- **Plugin** (`packages/grist`): registers the `grist` provider (4 ladder
  rungs as OpenAI-compatible models) and the hooks — `session.prompt` runs
  the Jev gate and switches to the chosen rung, `session.context` injects
  doctrine, `session.model.request` only ever escalates (never downgrades),
  `tool.execute.before/after` enforce budgets and collect stats,
  `permission.evaluate` auto-allows. `GRIST_CTRL=off` kills the control plane.
- **Gateway** (`packages/grist-gateway`): admits the request, enforces hard
  spend caps (402 at the cap), holds the ladder config and per-user provider
  keys (AES-256-GCM, never logged). Ships as a Docker image
  (`packages/grist-gateway/Dockerfile`) for Railway.
- **Shared logic** (`packages/grist-logic`): rung/mode/thresholds, Jev client,
  gate, control plane, doctrine, invite config — imported by both the plugin
  and the gateway.
- **Skill** (`skills/grist`, published as `@grist-ai/grist-skills`): teaches
  any personal AI agent to delegate multi-step coding tasks to the CLI.

## Repo layout

```
packages/grist/            @grist-ai/plugin — provider, hooks, CLI build/publish scripts
packages/grist-gateway/    @grist-ai/gateway — BYOK gateway (Bun.serve + bun:sqlite)
packages/grist-logic/      @grist-ai/logic — shared rung/gate/control-plane logic
skills/grist/              @grist-ai/grist-skills — agent skill for delegating to Grist
docs/v2-migration-plan.md  the v2 migration plan (7 phases)
```

Everything else is upstream OpenCode v2. The only upstream edit is an additive
`registerInstancePlugin()` registry in `packages/core/src/location-services.ts`
(no behavior change when empty) — the `grist` binary registers the plugin at
startup behind the `GRIST_BINARY` build define.

## Developing

```bash
export TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
export PATH="$HOME/workspace/tools/bun-linux-x64-1.4.2:$PATH"  # bun ^1.4.2

bun install --os="*" --cpu="*"   # full-platform install (builds need every pty binary)
bun typecheck                    # per package: bun typecheck from the package dir
bun test                         # per package, never from the repo root

# Dev binary (current platform):
bun run --cwd packages/grist build
# All publish targets:
bun run --cwd packages/grist build:all
```

## Upstream

Forked from [anomalyco/opencode](https://github.com/anomalyco/opencode) at
v2.0.18 (upstream `v2` branch). Rebase strategy: keep the Grist surface to
`packages/grist*`, `skills/grist`, and the additive instance-plugin registry —
everything else stays pristine upstream.

## License

MIT — see [LICENSE](LICENSE).
