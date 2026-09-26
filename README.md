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

## Quickstart (BYOK)

```bash
npm install -g grist-ai

# One of: export GRIST_API_KEY (a grist_sk_… key from the dashboard),
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
export PATH="$HOME/workspace/tools/bun-linux-x64:$PATH"  # bun ^1.3.14

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
v2.0.9 (upstream `v2` branch). Rebase strategy: keep the Grist surface to
`packages/grist*`, `skills/grist`, and the additive instance-plugin registry —
everything else stays pristine upstream.

## License

MIT — see [LICENSE](LICENSE).
