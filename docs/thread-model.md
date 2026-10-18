# Thread model (D0)

The desktop rebuild (see the D0–D5 plan) supervises **threads**, not a
single chat — the Codex app's core pattern. D0 defines the model as a
pure projection in `packages/grist-logic/src/thread-model.ts`, with two
sources feeding one view shape:

| Source | When | Mapper |
| --- | --- | --- |
| Durable session events (`session.*`, ~52 types) | live event-feed | `itemFromSessionEvent`, `projectThread` |
| Stored rows (`session_v2` + `session_message`) | replay / cold open | `summaryFromStoredRow`, `itemsFromStoredMessages`, `statusFromStoredMessages` |

**Why two sources:** this build's runtime does not retain the raw event
log (the `event` table is empty in a live database) — events are
projected into `session_v2`/`session_message`. The live feed and the
stored projection therefore have to land on the same shapes, and they
do: `ThreadSummary` + `ThreadItem`.

## The view shapes

- **ThreadSummary** — id, title, project, directory, parent/fork links,
  status (`running | succeeded | failed | interrupted | idle`), viewed
  flag, total cost, step and item counts. Sidebar ordering:
  `orderThreads` (running first, then most recent).
- **ThreadItem** — `message` (assistant text), `reasoning`, `tool`
  (called/success/failed + error), `step` (cost + files touched),
  `shell`, `compaction`, `usage`, `outcome`, `lifecycle`, and
  **`approval_request`**.

## Approvals

Approvals are requests a client answers, not log lines. In today's
runtime they take two forms, both already surfaced by the app: tool
**permission asks** (control-plane `allow | ask`, rendered by the
permission dock) and **question forms** (the `question` tool, rendered
by the question dock). The thread model represents them as
`approval_request` items; `approvalItemFromGateDecision` maps a gate
decision carrying an `ask_human` route into that shape.

Accuracy note (D1 audit, 2026-10-18): the current v2 gate does **not**
emit `ask_human` — `GateDecision` has no such route, and the composed
policy keeps underspecified tasks on the cheapest rung ("no ask-human
rung", jev-gate.ts). The adapter is the model contract for if/when that
route is wired; D1's attention badges are driven by the permission and
question requests that exist today.

## D1 — supervision sidebar

`packages/grist-logic/src/sidebar.ts` computes the sidebar view from
client `SessionInfo`: `summaryFromSessionInfo` (status from outcome /
idle timestamp), `threadBadge` (unread = updated after viewed;
needs-attention from pending request counts), and
`groupThreadsByProject` (project groups by recency, threads ordered
running-first). The app renders it via
`packages/app/src/grist/thread-sidebar.tsx`, mounted on Home under the
project list. Steering needs no new machinery: prompts to a busy
session deliver through the session inbox as steers (verified live:
a steer prompt sent mid-run was incorporated by the running session).

## D2 — worktree-per-thread

The runtime's worktree engine (protocol `server.worktree`, core
`Worktree` service, per-project inventory with strategy ownership) is
adopted as-is; Grist adds the thread layer in
`packages/grist-logic/src/worktree.ts`:

- **Auto-named branches.** Upstream creation was detached-HEAD only
  (the schema's `branch` input is a start ref). `Worktree.CreateInput`
  gained `newBranch`: the git strategy creates that branch at the start
  ref and checks it out in the worktree. The new-session flow passes
  `threadBranchName(...)` — `grist/<prompt-slug>-<short session id>` —
  so every worktree thread's work is a real, mergeable branch.
- **Cleanup planning.** `planWorktreeCleanup` marks a worktree stale
  when every thread that ran in it is archived. Only inventory rows
  with a recorded strategy (engine-created) can be planned, so cleanup
  never removes a foreign checkout; orphans require an explicit opt-in
  (a just-created worktree has no session yet). The v2 client cannot
  archive sessions yet (the app action is stubbed upstream), so today
  cleanup runs as an operator tool: `bun script/grist-worktrees.ts`
  (dry-run plan; `--apply` removes via `git worktree remove`, never
  forced). When the client archive API lands, the same plan drives the
  archive action.
- **Sidebar marker.** Threads whose directory is one of the project's
  sandboxes get a "Worktree" chip in the D1 sidebar.

Verified live (2026-10-18): two threads in two worktrees edited the
same file concurrently with no interference; merging one thread's
branch left the other's worktree intact; cleanup removed only the
archived thread's worktree.

## Ephemeral events

Delta events (`session.text.delta`, `session.reasoning.delta`,
`session.tool.input.delta`, compaction deltas) are live-streaming
fragments and intentionally map to no item; the durable `*.ended`
events carry the replayable full values.

## Try it

```sh
bun script/grist-threads.ts            # projects the live local database
bun script/grist-threads.ts --show <sessionID>
```

## What D1 consumes

The sidebar + thread view render `ThreadSummary[]` (ordered) and the
selected thread's `ThreadItem[]`; live updates arrive by folding
event-feed events through `itemFromSessionEvent` into the same list.
