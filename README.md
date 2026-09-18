# Grist

Self-hosted, confidence-gated coding-agent mill. A local model does the bulk of
agentic coding on the team's hardware. Jev (TypeSafe System One) scores each
task and routes it to **local**, **frontier**, or **ask human**. Institutional
memory — code map, conventions, ownership, decisions — is retrieved, not
re-explained every session.

This repository is the first usable slice: the **management plane, Jev gate,
spend log, and team memory**. The local 27B loop and llama.cpp box are
instrumented here in shadow so the mill can run before Phase 2 hardware lands.

One-line value: **frontier-tier output on a local budget, with memory that
survives turnover.**

## Run locally

```bash
npm install
npm test
npm run dev
```

Open [http://127.0.0.1:4327](http://127.0.0.1:4327).

Optional: copy `.env.example` to `.env.local` and set `TYPESAFE_API_KEY` to
evaluate against live Jev. Without a key, Shadow Jev uses the same
Score / Choice / Noul primitives.

## What this slice does

- **Intake** — submit a coding task. Sample prompts cover local, frontier, and
  human routes.
- **Gate** — every task hits Score (local confidence), Noul (high-stakes /
  underspecified), and Choice (suggested lane). TypeScript composes the route.
  Thresholds are editable; they are not a 70% pricing claim.
- **Memory** — seeded Prosh team profile from the bootstrap pipeline (snapshot,
  map, 18-month git, reviews, distillation).
- **Floor** — token spend, local/frontier/human split, all-frontier
  counterfactual, gate latency.
- **Box** — Pilot-tier appliance board. llama.cpp is not attached in this slice;
  local/frontier passes are simulated and logged.

## What it is not yet

Phases still ahead of this console: Bonsai 2 27B on llama.cpp, anomalyco
opencode pointed at that server, Langfuse, Graphify vs code-review-graph
bake-off, Supermemory + pydriller mining, and a live shadow burn-in.

Commercial numbers in the product spec are hypotheses until this log measures
them.

## Stack

Next.js, TypeScript, Tailwind, shadcn/ui. Gate evaluator talks to
`https://api.typesafe.ai/v1/systemone` when a key is present.
