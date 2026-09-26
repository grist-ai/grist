<p align="center">
  <img src="assets/grist-logo.svg" width="300" alt="Grist" />
</p>

<p align="center">
  <strong>A complete coding-agent harness.</strong><br />
  Confidence-gated model routing, institutional memory, and BYOK economics —
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

Grist is a coding-agent harness — a rebranded fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT).
The agent loop *is* this codebase: the same binary runs the chat, the IDE integration,
the CLI, and the desktop app. There is no separate wrapper process.

What makes it different is what's wrapped around that loop: a **Jev confidence
gate** that routes every task to the cheapest capable model rung; **institutional
memory** mined from your git history; a **code map** the gate can actually reason
over; **token mechanisms** that shrink context on every rung; and **BYOK
economics** — inference bills to your provider account (OpenRouter, Vercel AI
Gateway, or any OpenAI-compatible endpoint) with zero markup. Grist never holds
your inference budget.

## Benchmarks & economics

No cherry-picked leaderboards. What we can show you is the meter math, the gate
eval we run in CI, and the calibration loop we use to keep the gate honest.

### The meter math

Default ladder prices, snapshotted 2026-09-23 from OpenRouter's `/api/v1/models`
and checked into [`packages/opencode/src/grist/gateway/model-prices.ts`](packages/opencode/src/grist/gateway/model-prices.ts)
(per 1M tokens):

| Rung | Model | Input | Output |
| --- | --- | --- | --- |
| `cheapest` | `deepseek/deepseek-v4.1-flash` | $0.14 | $0.42 |
| `medium` | `moonshotai/kimi-k3` | $3.00 | $15.00 |
| `frontier` | `openai/gpt-6-sol` | $2.00 | $10.00 |
| `premium` | `anthropic/claude-opus-5.5` | $4.00 | $20.00 |

Worked example — one run burning 1M input + 200K output tokens (illustrative
arithmetic on the published prices above, assuming the task succeeds on the rung
the gate picks):

| Rung used | Cost of that run |
| --- | --- |
| `cheapest` | **$0.22** |
| `medium` | $6.00 |
| `frontier` | $4.00 |
| `premium` | $8.00 |

A rename-and-update-call-sites task the gate keeps on `cheapest` costs about
twenty-two cents instead of eight dollars on the top tier — **~36× cheaper** —
for work where the frontier model adds nothing. The gate itself is noise: in our
own dogfooding so far, total Jev gate spend is **$0.002**.

### The gate eval (runs in CI)

[`packages/opencode/src/grist/eval/battery.ts`](packages/opencode/src/grist/eval/battery.ts)
pins five routing decisions so the gate can't silently drift:

| Case | Task | Expected rung |
| --- | --- | --- |
| `trivial-rename` | Rename unused helper, update call sites | `cheapest` |
| `underspecified` | "Fix it." | `cheapest` |
| `auth-sensitive` | Harden auth middleware against expired JWT secrets | `cheapest` |
| `medium-refactor` | Multi-file race in the session runner | `medium` |
| `frontier-redesign` | Redesign the concurrent session coordinator | `frontier` |

```bash
bun run --cwd packages/opencode test src/grist/eval/battery.test.ts
```

### The calibration loop (shadow burn-in)

Every routing decision is logged to `.grist/burn-in.jsonl`; outcomes get labeled
later (success / fail / escalated, plus the counterfactual "would a cheaper rung
have succeeded?"). `bun scripts/burn-in-report.ts` prints the tier mix against
the design targets — **≥80% of tasks on `cheapest`, ≤5% on `frontier`** — plus
success rate and escalation precision. Thresholds are env-tunable with no code
change (`GRIST_TH_DIFF_MEDIUM`, `GRIST_TH_DIFF_FRONTIER`, …). Full spec:
[`docs/shadow-burn-in.md`](docs/shadow-burn-in.md).

## Features

### Jev confidence gate

Before a run starts, the gate ([TypeSafe Jev](https://typesafe.ai)) scores the
task on difficulty, confidence, underspecification, and sensitivity, then picks
the cheapest rung whose capability covers it. The gate runs **once per run** —
not once per step — so the dozens of cheap tool-call steps inside a run never
pay for re-judgment.

- The gate rides **your** provider key. No second API dependency, no separate
  gate key to manage, no gate vendor lock-in.
- Decisions are logged as `[grist:gate] cheapest|medium|frontier|premium` so you
  can see exactly why a task landed where it did.
- Underspecified prompts ("Fix it.") and sensitivity-capped tasks route
  *down*, not up — ambiguity is not a reason to burn frontier tokens.
- `GRIST_MODE=normal|capped|cheapest`: `capped` keeps frontier-class rungs off
  entirely; `cheapest` pins the workhorse. `GRIST_GATE=off` disables the gate
  when you want raw control.
- You never pin a rung with `-m`. The gate decides on every run; rung names are
  the only thing the client ever speaks.

### Cost-tiered model ladder

Four rungs, each the best model in its cost band — not capability classes, price
bands. The client only ever sees rung names (`cheapest`, `medium`, `frontier`,
`premium`); the gateway resolves them to upstream model ids. Swap a rung's model
server-side and every client picks it up with no update, no config edit, no
restart.

Three override layers, in precedence order:

1. **Your dashboard override** — Models tab, per account, per rung (`null`
   resets to default).
2. **Server env** — `GRIST_<RUNG>_MODEL` / `GRIST_<RUNG>_PROVIDER`
   (per-provider: `GRIST_<PROVIDER>_<RUNG>_MODEL`).
3. **Compiled defaults** — in
   [`packages/opencode/src/grist/gateway/ladder.ts`](packages/opencode/src/grist/gateway/ladder.ts).

```bash
curl -H "Authorization: Bearer $GRIST_SESSION" \
  https://grist.lol/v1/rung-models
# {"overrides": {"frontier": "openai/gpt-6-sol", "premium": null}}
```

Model changes require an account session — delegated `grist_sk_...` API keys get
a 401, the same posture as `/v1/api-keys`. A key you hand to an agent can't
re-point your ladder.

### BYOK — your key, zero markup

`grist auth login` prompts for your provider key (OpenRouter, Vercel AI Gateway,
or any OpenAI-compatible endpoint). From then on, every completion — and the Jev
gate itself — rides **your** key. Inference spend appears on your provider
invoice, at your provider's prices, with no Grist markup and no credits system
in between. Grist's hosted gateway only ever sees routing metadata, never your
inference budget.

Provider keys are encrypted at rest with AES-256-GCM (`GRIST_MASTER_KEY`), never
logged, and never returned by any API — not even to you after signup.

### Subagent re-gating

When a run decomposes into subagents, each delegation re-gates on its own
delegation text — with the parent's rung as a **ceiling**. Decomposed work can
only shed cost, never gain it: a `frontier` parent can spawn `cheapest`
children, but a `cheapest` parent can never escalate a child to `medium`. Pinned
models and passthrough sessions keep their inherit behavior.

### Token mechanisms (SoL-Pi ports)

Two harness-level mechanisms cut tokens on every rung, controlled by
`GRIST_MECH=auto|efficiency|performance|off` (default `auto`):

- **ObservationPack** — tool outputs over 10KB are delivered in full twice for
  the same `(tool, content)` identity, then replaced with a handle plus a ~1KB
  excerpt (first ~256 bytes + the tail, so build/test errors survive packing).
  The full text stays on disk; `Grep`/`Read` the path for more. Kill switch:
  `GRIST_OBS_PACK=off`. Logged as `[grist:observation-pack]`.
- **Action Fusion** — the `edit_verify` tool fuses an exact-string edit and its
  follow-up shell verification into **one** call, instead of `edit` → `bash` as
  two round trips. The agent doctrine nudges the model to prefer it whenever the
  change has a clear check.
- **Observation-pack compressor** — exploration runs in a subagent and only a
  digest returns to the main context, so recon sweeps don't flood the parent's
  window.

`auto` picks per task: exploration/diagnosis gets full-fidelity `performance`,
build/test/edit gets `efficiency`. The choice is remembered per session.

### Code map

The gate sees the real call graph on hard tasks, not just file names:

- **Graphify** — AST-level code graph (structural, $0, instant, no egress).
  Chosen over embedding-based maps after a bake-off: same structural accuracy,
  none of the GPU/cloud-embedding cost.
- **Custom tree-sitter rule** — extracts Express route registrations, so the map
  knows which handler serves which endpoint.
- `grist bootstrap` pins the repo SHA and mines the graph on first run; the map
  is refreshed as the code changes.

### Memory that survives turnover

Two layers, both yours:

- **Ownership mining** — `grist bootstrap` walks your git history and writes
  `.grist/bootstrap/ownership.jsonl`: who owns what, by evidence, not by org
  chart. Review it before persisting anything — it's your history, you decide
  what the agent remembers.
- **Supermemory sidecar** — self-hosted, MIT-licensed memory service for
  cross-session recall; falls back to `.grist/memory.json` when the sidecar
  isn't running.

The next session — yours, a teammate's, or an agent's — starts briefed instead
of cold.

### Control plane

The loop that keeps long runs productive instead of expensive:

- **Escalation** — stuck or failing runs escalate with context, not just retries.
- **Permissions** — destructive tools stay behind approval; the agent asks
  before it `rm -rf`s.
- **Verify** — claims get checked against the repo (tests, builds, grep) rather
  than trusted from the transcript.
- **Tool budgets** — runaway tool loops hit a budget instead of your wallet.

(What *isn't* here anymore: the old custom stop heuristics — step budgets and
"task likely complete" guesses — were removed because they kept killing
productive runs. OpenCode's built-in loop limits are the runaway protection.)

### Hard spend caps & usage metering

- **Hard caps on the house key**: when a request would exceed the cap, the
  gateway answers **402**, not a surprise charge. Per-account caps on BYOK keys
  are soft today — the roadmap is making them hard.
- **Per-rung metering**: `grist usage` shows spend broken down by rung, and
  `/v1/usage` reports the provider alongside, so you can see exactly where the
  money went and tune the ladder or thresholds from evidence.

### Dashboard

At [grist.lol/dashboard](https://grist.lol/dashboard):

- **Models** — override any rung with your own model id, or clear back to the
  default. This is the per-account override layer from the ladder section.
- **API keys** — mint named `grist_sk_...` keys, each independently revocable,
  shown once, stored hashed. Hand one to any AI assistant and it acts as a
  client with spend attributed to your account.
- **Usage** — spend by rung and provider.

Accounts are open: sign in, get an account code, done. No invites. Firebase
first-session auto-creates and binds the account; device approval auto-mints.

### CLI, TUI, desktop, IDE

It's OpenCode underneath, so the full surface comes along:

- `grist` — the TUI agent; `grist run` — headless one-shot runs for scripts and
  CI (`--format json` for the session id, `--dir` to sandbox, `--session` to
  resume).
- `grist init` / `grist bootstrap` — project onboarding: pin SHA, mine code
  ownership, build the code map.
- `grist auth login|status|logout`, `grist models`, `grist usage`, `grist config`,
  `grist logs`, `grist doctor`, `grist update`.
- Desktop app and IDE integrations from the upstream fork.

## Architecture

One request, six moves. The client speaks rung names only — vendor model ids
never ship in the client binary; the gateway resolves everything.

```
┌──────────┐  task + rung   ┌─────────┐  grist_sk auth   ┌──────────┐
│ CLI/TUI/ │ ─────────────▶ │ Gateway │ ───────────────▶ │ Jev gate │
│ Desktop  │                │         │  cap check (402) │  1×/run  │
└──────────┘                └────┬────┘                  └────┬─────┘
                                 │ rung                       │ rung
                                 ▼                            ▼
                          ┌────────────┐   model id    ┌──────────────┐
                          │   Ladder   │ ────────────▶ │   Provider   │
                          │ rung→model │               │  (your key)  │
                          └────────────┘               └──────────────┘
                                 ▲
                 ┌───────────────┴────────────────┐
                 │ defaults (ours)                │
                 │ dashboard override (yours)     │
                 └────────────────────────────────┘
```

- **Gateway**: admits the request (`grist_sk_...` identifies the account),
  enforces hard spend caps, holds the ladder config and per-user provider
  keys (AES-256-GCM, never logged, never returned by any API).
- **Jev gate** ([TypeSafe Jev](https://typesafe.ai)): scores task
  difficulty/confidence once per run and routes to the cheapest rung that can
  handle it. The gate rides *your* provider key — no second API dependency.
- **Subagent re-gating**: delegation text re-gates with the parent's rung as a
  ceiling, so decomposed work can only shed cost, never gain it.
- **Ladder**: rung → upstream model. Four cost-tiered rungs
  (`cheapest`/`medium`/`frontier`/`premium`); `GRIST_<RUNG>_MODEL` env
  overrides on the server, per-account overrides from the dashboard.
- **BYOK**: the provider call rides *your* key (OpenRouter, Vercel AI Gateway,
  or any OpenAI-compatible endpoint). Inference bills to your provider
  account — Grist never holds your inference budget.
- **Memory**: Supermemory sidecar (self-hosted, MIT) or `.grist/memory.json`;
  ownership mined from your git history via `grist bootstrap`, so the next
  session starts briefed.

## Why this wins

Most coding agents make you pick **one** model per session and pay its rate for
everything — the rename, the refactor, and the redesign all burn frontier
tokens. Grist's bet is that model choice is a *routing* problem, not a settings
problem:

| | Grist | Claude Code / Cursor | Aider / Cline | Vanilla OpenCode |
| --- | --- | --- | --- | --- |
| Model routing | Per-task confidence gate → cheapest capable rung | One model per session, manual switching | One model per session | One model per session |
| Billing | BYOK, zero markup, provider-metered | Subscription / credits with markup | Your key, no routing | Your key, no routing |
| Memory | Git-history ownership mining + Supermemory | Per-project markdown files | — | Per-project files |
| Spend control | Hard caps (402), per-rung usage | Budget alerts at best | — | — |
| Model agility | Rung names — swap models server-side, zero client churn | — | — | Per-client config edit |
| Decomposition cost | Subagents re-gate under a cost ceiling | — | — | — |

The honest version of the claim: Grist doesn't out-generate a frontier model —
it *is* the frontier model when the task needs it, and a $0.22 workhorse when it
doesn't. The win is measured in dollars per shipped diff, not vibes.

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

## Configuring the ladder

Server defaults live in `packages/opencode/src/grist/gateway/ladder.ts` and
can be overridden per rung with `GRIST_<RUNG>_MODEL` /
`GRIST_<RUNG>_PROVIDER` env vars (per-provider: `GRIST_<PROVIDER>_<RUNG>_MODEL`).

Users override any rung from the dashboard (**Models** tab) or via
`PUT /v1/rung-models` (account session, same posture as `/v1/api-keys` —
delegated `grist_sk_...` keys can't change models):

```json
{ "overrides": { "frontier": "openai/gpt-6-sol", "premium": null } }
```

`null` resets a rung to the default.

Precedence: account override → env → compiled default.

## Self-hosting the gateway

The gateway holds the ladder config, the gate, and per-user provider keys
(encrypted at rest, never logged, never returned by any API). `grist_sk_...`
API keys identify the *user*; accounts are open — anyone can sign in and get an account code, no invite needed.

```bash
bun install
export GRIST_MASTER_KEY=$(openssl rand -hex 32)  # encrypts user provider keys at rest
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
