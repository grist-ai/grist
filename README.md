# Grist

Self-hosted, confidence-gated coding mill. **Run it on your hardware.** It is
not a cloud service and it is not hosted in a Cursor agent VM.

A small local model (Bonsai 2 27B via llama.cpp) does the bulk of agentic
coding. Jev scores each task and routes **local** / **frontier** / **ask
human**. Local work hands off to [OpenCode](https://github.com/anomalyco/opencode)
on this machine.

One-line: **frontier-tier output on a local budget, with memory that survives
turnover.**

## Run on your machine

```bash
git clone https://github.com/pranav6226/grist.git
cd grist
npm install
npm test
```

Install OpenCode (the locked agent loop) on the same box:

```bash
npm i -g opencode-ai
# or: curl -fsSL https://opencode.ai/install | bash
opencode --version
```

Gate a task in the terminal. Local routes exec `opencode run`:

```bash
npm run mill -- "Rename the unused fetchLegacyMap helper in src/graph/map.ts and update call sites."
```

Other sample prompts:

```bash
# stays local (scoped test)
npm run mill -- "Add a regression test in src/ownership/miner_test.py for skipping bot commits and merges."

# asks you — too vague
npm run mill -- "Fix it."

# frontier — production ledger, will not call OpenCode
npm run mill -- "We're seeing duplicate charges in payouts — redesign the ledger to be idempotent and migrate production."
```

Exit codes: `0` OpenCode finished, `2` ask human, `3` frontier (not executed),
`4` local but OpenCode missing.

Optional live Jev (otherwise Shadow Jev, same Score / Choice / Noul shape):

```bash
cp .env.example .env.local
# set TYPESAFE_API_KEY
TYPESAFE_API_KEY=... npm run mill -- "<task>"
```

### Operator floor (optional, still local)

A localhost dashboard for spend, memory, and threshold calibration. Start it
yourself; nothing is served from the agent environment.

```bash
npm run floor
# open http://127.0.0.1:4327 on this machine
```

## What the mill does today

- **Gate** — every task hits Jev Score / Choice / Noul; TypeScript composes the
  route. Thresholds are calibrated, not a 70% pricing claim.
- **Local handoff** — `opencode run` on this box when the gate says local.
- **Memory** — seeded Prosh profile (architecture, ownership, conventions).
- **Floor** — optional local UI for token spend and the human queue.

## Not yet (later phases on your box)

llama.cpp + Bonsai 2 27B, Langfuse, Graphify vs CRG bake-off, Supermemory +
pydriller mining, live shadow burn-in. Point OpenCode at the local model when
the box is up (`opencode --model` / provider config).

## Stack

TypeScript mill (gate + CLI). OpenCode is the agent loop. Optional Next.js
floor on localhost. Jev at `https://api.typesafe.ai/v1/systemone` when a key is
present.
