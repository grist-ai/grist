# @grist/route-graph

Express route-registration extraction for Grist's Graphify-based code map.

## Why

AST graph extractors (Graphify, CRG) produce no edge for `router.post(path,
handler)` — the call is a framework registration, not a visible call to the
handler. That makes the highest-value map question — "what HTTP endpoint
reaches this code?" — unanswerable from the graph. This package closes the gap
as a post-extraction step over `graphify-out/graph.json`.

## What it does

1. Scans TypeScript/JavaScript sources with tree-sitter (`web-tree-sitter` +
   `tree-sitter-typescript` WASM, the same stack the repo already uses).
2. Detects `router.METHOD(path, ...handlers)` / `app.METHOD(path, ...handlers)`
   for `get post put delete patch all options head`, `router.route("/p").get(h)`
   chains, and `app.use(path, router)` mounts.
3. Merges into `graph.json`:
   - one route node per registration (`POST /channels/:id/messages`),
   - `handles_route` edges (route → handler),
   - `mounts` edges (app/router → mounted sub-router).
4. Resolves handlers to existing graph nodes via import resolution
   (`import messageController from "../controllers/MessageController"` →
   `MessageController.ts` → `sendMessage` method node). Unresolvable handlers
   (inline arrows, `express.json()`, unknown references) get synthetic nodes
   marked `INFERRED` instead of dangling edges.

## Usage

```sh
bun src/index.ts --graph graphify-out/graph.json --repo /path/to/repo --out graphify-out/graph.aug.json --write
```

Without `--write` it only prints stats. The original graph is never overwritten
unless `--out` points at it.

## Validation

`bun test` — 15 tests covering every handler shape (member, identifier,
inline, expression), middleware chains, `app.use` mounting, constant/template
paths, `router.route()` chains, and non-router false positives.

Integration check on the Prosh repo (872 files): 540 registrations → +919
nodes / +717 links, zero named-handler misses, zero dangling targets. The
bake-off's ground truth — `router.post('/channels/:channelId/messages',
messageController.sendMessage)` — now reverse-resolves from the `sendMessage`
node to `POST /channels/:channelId/messages`.
