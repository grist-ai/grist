---
name: grist
description: Delegate multi-step coding tasks in a git repo to Grist, the open-source agentic coding-harness CLI: features, bug fixes, refactors spanning multiple files. Not for single-file edits or non-coding questions.
---

# Grist

Grist is an open-source agentic coding-harness CLI. You delegate a multi-step
coding task; Grist's Jev gate scores it and picks the cheapest capable rung of
its 4-rung ladder (cheapest → medium → frontier → premium), then leaves the
result as a diff on a branch for review. Upstream model identities are never
exposed — address rungs by name only.

## Install

```bash
npm install -g grist-ai
```

## Auth

The human signs in once per machine. Two ways:

**Interactive** (recommended): `grist auth login` opens the Grist site and the
account is created on first sign-in. After login it asks for the inference
provider key (BYOK): OpenRouter, Vercel AI Gateway, or a custom
OpenAI-compatible endpoint. The key is stored encrypted on the gateway and
only ever runs inference for that account.

**Headless** (agents/VMs): mint an API key at
`https://grist.lol/dashboard/api`, then either run
`grist auth login --provider grist --api-key "$GRIST_API_KEY"` or just export
`GRIST_API_KEY` — the CLI picks it up. The key looks like `grist_sk_…`
(64 hex chars). Self-hosted gateway: add `--gateway <url>` (default
`https://grist.lol`).

Key hygiene (non-negotiable): never print, log, commit, or paste the key into
chat. Pass it via environment variable only. If it leaks, tell the human to
revoke it on the dashboard and stop.

Verify without exposing anything: `grist usage` shows spend against the
account cap.

## Billing (BYOK)

Inference bills to the human's own provider key — not to Grist. The Grist
account carries a spend cap that the gateway meters per (provider, resolved
model); `grist usage` shows the remaining budget and per-rung spend. The cap
is hard: at the cap the run 402s, and only the human can raise it (on the
dashboard — a `grist_sk_…` key can never raise its own cap). Keep
tasks scoped: one feature or fix per run.

## Run

Headless, JSON on stdout, `--dir` pointing at the git checkout:

```bash
grist run --format json --auto --dir /path/to/repo "Precise task: what to change, where, and how to verify."
```

- Do NOT pass `-m`. The Jev gate picks the rung per run; pinning one
  (`-m cheapest|medium|frontier|premium`) is only for when the human
  explicitly asks for it.
- `--auto` auto-approves tool permissions that are not explicitly denied.
  Headless runs need it (nothing can answer a prompt), and it is dangerous —
  keep `--dir` scoped to the repo you intend to change.
- Do not use the interactive TUI.

Each stdout line is one JSON event: capture `sessionID` from the first event;
`type: "text"` carries assistant output in `part.text`; `type: "tool_use"` is
file edits and shell; `type: "error"` means failure — stop and report. When
the process exits, Grist is done: inspect the tree yourself (`git status`,
`git diff`).

Resume the same session:

```bash
grist run --format json --auto --dir /path/to/repo -c "Continue: address the test failure in …"
grist run --format json --auto --dir /path/to/repo -s "$SESSION_ID" "Continue: …"
```

## Workflow

1. Pull the repo. Create a fresh branch. Never work on `main`.
2. Write a precise prompt (files, behavior, tests). Run Grist.
3. Read the diff. If it is wrong or too broad, continue the session with a
   tighter prompt — or stop.
4. Run the repo's tests.
5. Push the branch. Open or describe a PR. Never merge to `main`.
6. Report back.

## Hard rules

- Only run Grist on repos and machines you are allowed to modify.
- Never expose the API key.
- One feature or fix per run — not "clean up the repo".
- Branches only. Never push to `main` or the default branch.

## Report

What changed (files and behavior), the branch name, test results, and cost
(`grist usage` before/after, or remaining budget).
