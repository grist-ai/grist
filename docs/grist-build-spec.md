# Grist — Build Specification

> **Working product name:** Grist (screened against USPTO records Sept 2026 — no live
> Class 009/042 word mark for "GRIST" found; attorney clearance still required before launch).
> If the name changes, find-replace across this doc.

## 1. Product definition

Grist is a self-hosted, confidence-gated coding-agent harness for engineering teams.
A small local model does the bulk of agentic coding work on the team's own hardware;
a confidence gate (Jev) routes only low-confidence or high-stakes tasks to frontier
API models. Institutional knowledge — code map, conventions, ownership, decisions —
is mined from the team's own history and fed to agents as retrieval, not re-explained
every session.

One-line value prop: **frontier-tier output on a local budget, with institutional
memory that survives turnover.**

Design principles:
- **Local-first, gated escalation.** The default is the local model; frontier is the
  exception, decided per-task by a confidence score — never by vibes.
- **Zero marginal cost per local task.** After hardware, local tokens are free.
- **Sovereignty.** Code, history, and memory never leave the customer's hardware
  (except explicitly escalated tasks, which go to the frontier API).
- **Self-adapting = retrieval + feedback loops, not weight updates.** The system
  gets smarter via richer memory and calibrated gate thresholds, never fine-tuning.
- **Instrument first.** Token spend and gate precision are measured from day one;
  every commercial claim must be reproducible from the logs.

Non-goals:
- Not a model. Not a fine-tuning pipeline. Not a cloud IDE.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        ENGINEER                               │
│                    (chat / IDE / CLI)                         │
└──────────────────────────────┬──────────────────────────────┘
                               │ task
┌──────────────────────────────▼──────────────────────────────┘
│  CONFIDENCE GATE (Jev — TypeSafe System One)                  │
│  Score/Choice/Noul per task:                                  │
│   route ∈ { local_model, frontier_escalation, ask_human }     │
│  Thresholds calibrated during shadow burn-in (Phase 8).      │
└──────┬───────────────────────────────┬───────────────────────┘
       │ high confidence               │ low confidence / high stakes
┌──────▼───────────────┐      ┌────────▼────────────────┐
│ LOCAL AGENT LOOP     │      │ FRONTIER ESCALATION     │
│ opencode (anomalyco  │      │ Claude / GPT API,       │
│ fork) + Ternary      │      │ metered, logged         │
│ Bonsai 2 27B via     │      │                         │
│ llama.cpp            │      │                         │
└──────┬───────────────┘      └─────────────────────────┘
       │ tools + retrieval
┌──────▼───────────────────────────────────────────────────────┐
│ KNOWLEDGE LAYER                                               │
│  Code map (Graphify OR code-review-graph — bake-off open)     │
│  Agent memory (Supermemory, self-hosted)                      │
│  Ownership mining (pydriller → Supermemory)                   │
│  Optional: Qdrant / kuzu for vector/graph scale               │
└──────┬───────────────────────────────────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────────┐
│ SANDBOX                                                       │
│  v1: Docker-based sandbox on the same box (practical)        │
│  scale-up path: E2B Runtime (self-hosted)                     │
└──────┬───────────────────────────────────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────────┐
│ OBSERVABILITY                                                 │
│  Langfuse (traces, token spend per task)                      │
│  inspect_ai (evals: gate precision, task success)              │
└──────────────────────────────────────────────────────────────┘
```

## 3. Locked component decisions

| Layer            | Choice                              | Repo / Source                    | License    | Status  |
|------------------|-------------------------------------|----------------------------------|------------|---------|
| Agent loop       | opencode (anomalyco fork — live)     | anomalyco/opencode               | MIT        | LOCKED  |
| Code model       | Ternary Bonsai 2 27B (5.9 GB, 1.76 bits/wt, 262K ctx, Qwen3.8-based VLM) | PrismML               | Apache-2.0 | LOCKED  |
| Inference server | llama.cpp (parallel slots)          | ggerganov/llama.cpp              | MIT        | LOCKED  |
| Confidence gate  | Jev (TypeSafe System One, `jev-latest`; Choice/Score/Noul; $0.042/MTok in, output free, 70–500 ms) | api.typesafe.ai/v1/systemone via typesafe-sdk | commercial API | LOCKED (key capture pending) |
| Code map         | **OPEN: Graphify vs code-review-graph bake-off** | —                          | MIT both   | OPEN    |
| Agent memory     | Supermemory (self-hosted, OpenCode plugin) | supermemory                      | MIT        | LOCKED  |
| Ownership mining | pydriller → Supermemory             | pydriller                        | (verify)   | LOCKED  |
| Sandbox          | Docker sandbox v1 → E2B Runtime at scale | e2b-dev/E2B                  | Apache-2.0 | LOCKED  |
| Vector/graph     | Qdrant / kuzu (only if scale demands) | —                              | —          | OPTIONAL|
| Observability    | Langfuse + inspect_ai               | —                                | —          | LOCKED  |

Map-layer bake-off (must resolve before Phase 6):
- **Graphify**: deterministic AST-only graph, zero API cost. The "map".
- **code-review-graph (CRG)**: MCP-native (25–30 tools), blast-radius/impact analysis,
  embedding semantic search, incremental watch mode. MIT but fork-soup (5+ forks;
  unclear canonical — the-sanders-management-group most recently active).
- Method: head-to-head on the Prosh repo; measure token spend per task + retrieval
  quality. Winner locks the layer.

Open verification items:
- PrismML fork of llama.cpp vs mainline llama.cpp for ternary kernels (perf check).
- pydriller license confirmation.

## 4. The confidence gate (Jev)

Every task passes through the gate before any model is invoked.

```
task ──► Jev Score(confidence) ──► confidence ≥ threshold  ──► LOCAL (Bonsai 2 27B)
              │
              ├──► confidence < threshold ──► FRONTIER (metered API)
              │
              └──► Noul / unknown ──► ASK HUMAN
```

- Gate primitives: `Score` (0–1 confidence), `Choice` (route decision),
  `Noul` (explicit unknown → human).
- Jev makes **decisions, not text**: it never writes summaries; deterministic rules
  (bot commits, date bounds, dedup) stay as code.
- Thresholds are **calibrated, not guessed**: Phase 8 shadow burn-in produces labeled
  examples (task → local success / local failure / needed escalation) that set the
  operating threshold. Target: ~70% of tasks stay local (POC validates; do not
  hardcode the assumption into pricing or docs).
- Gate latency budget: 70–500 ms per call; cost $0.042/MTok in, output free
  (negligible vs frontier tokens).
- The gate is also the bootstrap triage judge (see §5) and a concurrency feature:
  every escalated task is load the local box never sees.

Prototype reference: `~/workspace/jev-confidence-gate/` (`jev_gate.py`, `demo.py`,
`README.md`). API key capture still pending — unblock before Phase 5.

## 5. Cold-start bootstrap pipeline

For existing teams with large codebases. One overnight job; resumable, idempotent.

1. **Snapshot** the repo at a pinned SHA.
2. **Full code-map build** — tree-sitter, parallelized (millions of LOC in minutes–1 hr).
3. **Bounded git history** — pydriller over last 12–18 months (~20–50k commits),
   sharded (pydriller is single-threaded), skipping merges and bot commits.
4. **Prioritized PR/review/issue ingestion** — ranked by discussion depth (review
   comments = convention gold) via GitHub GraphQL (rate-limit friendly).
5. **Map-reduce distillation** — per-module/per-author summaries rolled up into one
   team profile. **This is the one step worth spending frontier tokens on
   (~$50–200 one-time, amortized over the deployment's life).**
6. **Seed Supermemory team profile** — architecture, ownership, conventions, gotchas.
7. **1–2 week shadow burn-in** — every real task becomes a labeled example that
   calibrates gate thresholds.

Jev's role in bootstrap (judgment, not text):
- Triage: `Choice {worth_distilling, skip}` / `Score` for signal density over
  PRs/reviews/threads.
- Conflict resolution: `Choice {keep_new, keep_old, keep_both, ask_human}` when
  history contradicts itself on conventions.
- Bootstrap ends with a short tech-lead questionnaire ("12 things we couldn't
  resolve, 5 minutes of your time") — cold start becomes an onboarding moment.

Failure modes handled: dead code (weight by churn/imports, not presence), rewrites
(recency weighting), API rate limits, slow miners (shard everything).

Future context sources (shelved — revisit post-POC): Slack (allowlisted channels
only, never DMs; Jev scores threads for signal density), Jira (ticket→PR links
carry the *why*), Confluence/RFCs/ADRs. Privacy note: "we read your Slack" needs
explicit channel scoping and the sovereignty story up front in the pitch.

## 6. Build phases (in order — each unlocks the next)

1. **Box.** Mac mini M4, 24GB+ unified memory (~$800). (Laptop works for Phases 2–3
   to validate at $0; the dedicated box earns its keep at Phase 8.)
2. **Model running.** llama.cpp + Bonsai 2 27B ternary; verify ~20–28 tok/s.
   On 16GB machines cap per-slot context at 16K; 24GB+ can run 32K.
3. **Agent loop.** anomalyco opencode pointed at the local model; run real tasks
   against the pilot repo. Baseline question: does it produce working code at all?
4. **Instrument on day one.** Langfuse + token-spend logging before anything else
   changes. No before/after numbers = no commercial story.
5. **The gate.** Wire the Jev prototype between task intake and model routing
   (local vs escalate vs ask-human). **Blocker: API key submission pending.**
6. **Map bake-off.** Graphify vs CRG on the pilot repo; measure token spend +
   retrieval quality; lock the layer.
7. **Memory.** Supermemory + pydriller ownership mining; run the bootstrap
   pipeline (§5) over the pilot repo's history.
8. **Shadow burn-in.** 1–2 weeks of real tasks in shadow mode; calibrate gate
   thresholds; produce the real numbers (local/escalate split, $ saved).

## 7. Hardware tiers (planning estimates — POC validates slot counts)

| Tier       | Engineers | Hardware                                              | Active slots | Cost        |
|------------|-----------|-------------------------------------------------------|--------------|-------------|
| Pilot      | 1–3       | Mac mini M4, 24GB+ unified memory                     | 2–4          | ~$800–1,000 |
| Team       | 5–10      | Mac Studio 36GB+ **or** single 24GB-GPU Linux box (used RTX 3090 build) | 4 | ~$2,000–2,500 |
| Department | 15–30     | 2× Team boxes, or one dual-GPU Linux box              | 6–8          | ~$4,000–6,000 |
| Enterprise | 30+       | Multi-node, one pod per team, load-balanced           | 8+           | Custom      |

Concurrency math: llama.cpp parallel slots **split** total throughput (~25 tok/s
÷ 4 slots ≈ ~6 tok/s each at ~32K context). Works because agentic coding is bursty
(~10–20% of engineers actively generating at any moment). Size RAM/CPU for the
**sandbox test runs** — the spikiest load, not inference. GPU market note (Sept 2026):
do NOT buy an RTX 5090 at $5,000–7,500 street for a 5.9 GB model; used RTX 3090
(24GB) is the value play; Apple Silicon is the simplest path.

Delivery model: pilots ship as a pre-configured **appliance** (zero setup friction);
at scale, bring-your-own-hardware against certified reference specs with an
installer that validates hardware at install time.

## 8. Economics context (why measurement matters)

Reference model (10 engineers, ~100 agentic tasks each/month):
- Baseline (metered frontier agents): ~$2,000/mo tokens.
- With Grist at ~70% local: ~$600 escalated frontier + ~$100 hardware amortized
  + software fee → **~$1,390–1,490/mo all-in (~25–30% cheaper)**, plus sovereignty
  and compounding memory.
- Hardware amortizes to ~$8–10/engineer/month — negligible.
- The 70% local figure is the key assumption: the POC measures it, never asserts it.

Pricing direction (hypothesis until 3 pilots validate — start high, discount to close):
Team $69/seat/mo · Department $59/seat/mo + $1,500/mo platform · Enterprise/sovereignty
custom $100k+/yr · Paid pilot $2,500/30 days credited to annual · Savings guarantee:
30% cut in AI coding spend in 90 days or the next quarter is free.

## 9. Constraints

- **Personal project. Never Necora code, repos, or infrastructure.** The pilot repo
  is Prosh; outside companies are the POC targets once built.
- Every commercial number in this doc is a hypothesis until the POC measures it.
- Build in the open where the stack is open; the commercial layer is the installer,
  the gate, the bootstrap pipeline, profile seeding, the management plane, support.
