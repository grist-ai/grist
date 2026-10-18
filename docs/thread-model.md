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

Approvals are requests a client answers, not log lines. The Jev gate's
`ask_human` route maps to an `approval_request` item via
`approvalItemFromGateDecision` — D1 renders it as a card in the thread;
the permission system rides the tool item lifecycle (called →
success/failed).

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
