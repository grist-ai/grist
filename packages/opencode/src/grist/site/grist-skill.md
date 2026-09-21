---
name: grist
description: Delegate multi-step coding tasks in a git repo to Grist: features, bug fixes, refactors spanning multiple files. Not for single-file edits or non-coding questions.
---

# Grist

Delegate multi-step coding tasks in a git repo to Grist: features, bug fixes, refactors spanning multiple files. Not for single-file edits or non-coding questions.

## Prerequisites

Grist must already be installed on this VM (`npm install -g grist-ai`). Completions go through the Grist gateway.

The API key lives in a secure vault or a mode-0600 environment variable. Never paste it into chat. Never write it into this skill file, a prompt, a commit, or a log.

```bash
export GRIST_GATEWAY_URL="${GRIST_GATEWAY_URL:-https://grist.lol}"
export GRIST_API_KEY  # already injected from the vault — do not echo it
grist usage           # confirms auth without printing the key
```

If `grist` is missing or `grist usage` fails, stop and tell the human. Do not invent a key.

## How to invoke

Headless, one shot, JSON on stdout. Point `--dir` at the git checkout. `--auto` is required so tool permissions are not rejected.

```bash
grist run --format json --auto --dir /path/to/repo "Precise task: what to change, where, and how to verify."
```

Each stdout line is one JSON event:

- `sessionID` — capture this from the first event
- `type: "text"` — assistant output in `part.text`
- `type: "tool_use"` — file edits and shell
- `type: "error"` — failure; stop and report
- process exit — Grist is done; inspect the tree yourself (`git status`, `git diff`)

Resume the same session:

```bash
grist run --format json --auto --dir /path/to/repo -c "Continue: address the test failure in …"
# or, if you stored the id:
grist run --format json --auto --dir /path/to/repo -s "$SESSION_ID" "Continue: …"
```

Do not use the interactive TUI. On a headless VM, set `GRIST_API_KEY` (or run `grist auth login --provider grist --api-key "$GRIST_API_KEY"` once). Do not open a browser login.

## Workflow

1. Pull the repo. Create a fresh branch. Never work on `main`.
2. Write a precise prompt (files, behavior, tests). Run Grist as above.
3. Read the diff (`git diff`, `git status`). If it is wrong or too broad, continue the session with a tighter prompt or stop.
4. Run the repo’s tests.
5. Push the branch. Open or describe a PR. Never merge to `main`.
6. Report back.

## Hard rules

- Only run Grist on repos and machines you are allowed to modify.
- Never expose the API key. If it leaks, revoke it on the Grist dashboard and stop.
- Keep tasks scoped. Spend bills to the human’s Grist account. One feature or fix per run — not “clean up the repo.”
- Branches only. Never push to `main` or the default branch.

## What I report

- What changed (files and behavior)
- The branch name
- Test results
- Roughly what it cost (`grist usage` before and after, or remaining USD)
