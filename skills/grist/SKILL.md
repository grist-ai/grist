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

The human's Grist API key (`grist_sk_…`, 64 hex chars) reaches the CLI one of
two ways:

- Environment: export `GRIST_API_KEY` (mode-0600 env, never paste it into chat).
- Config file: `~/.grist/config.json` (or `GRIST_CONFIG_PATH`), holding the
  key and gateway URL.

`GRIST_GATEWAY_URL` selects the gateway (default `https://grist.lol`;
self-hosted setups override it).

Key hygiene (non-negotiable): never print, log, commit, or paste the key into
chat. Pass it via environment variable only. If it leaks, tell the human to
revoke it on the dashboard and stop.

Verify without exposing anything:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-Grist-Api-Key: $GRIST_API_KEY" "$GRIST_GATEWAY_URL/v1/usage"
# 200 = key is good; also shows spend against the account cap
```

If `grist` is missing or the usage check fails, stop and tell the human. Do
not invent a key.

## Billing (BYOK)

Inference bills to the human's own provider key — not to Grist. The Grist
account carries a spend cap that the gateway meters per (provider, resolved
model); `/v1/usage` shows the remaining budget and per-rung spend. The cap
is hard: at the cap the run 402s, and only the human can raise it (on the
dashboard — a `grist_sk_…` key can never raise its own cap). Keep
tasks scoped: one feature or fix per run.

## Run

Headless, JSON on stdout. `cd` into the git checkout first — there is no
`--dir` flag; the run inherits the calling directory:

```bash
cd /path/to/repo
grist run --format json --auto "Precise task: what to change, where, and how to verify." < /dev/null
```

- Do NOT pass `-m`. The Jev gate picks the rung per run; pinning one
  (`-m cheapest|medium|frontier|premium`) is only for when the human
  explicitly asks for it.
- `--auto` auto-approves tool permissions that are not explicitly denied.
  Headless runs need it (nothing can answer a prompt), and it is dangerous —
  keep the checkout scoped to the repo you intend to change.
- `< /dev/null`: `grist run` waits for stdin EOF even with a message argument;
  on a non-interactive shell it hangs silently without the redirect.
- Do not use the interactive TUI.

Each stdout line is one JSON event: capture `sessionID` from the first event;
`type: "text"` carries assistant output in `part.text`; `type: "tool_use"` is
file edits and shell; `type: "error"` means failure — stop and report. When
the process exits, Grist is done: inspect the tree yourself (`git status`,
`git diff`).

Resume the same session (it restores its own working directory):

```bash
grist run --format json --auto --session "$SESSION_ID" "Continue: …" < /dev/null
# or shorthand: grist run --format json --auto -c "Continue: …" < /dev/null
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
(`/v1/usage` before/after, or remaining budget).
