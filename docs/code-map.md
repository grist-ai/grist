# Code map bake-off (Phase 4)

Lock the knowledge-layer code map by measuring **Graphify** vs
**code-review-graph (CRG)** on Prosh (pre-POC §6 / §9).

## Contenders

| Provider | Strength | Cost | Integration |
| --- | --- | --- | --- |
| **Graphify** ([Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)) | Deterministic tree-sitter AST; `graph.json` (NetworkX node-link); zero API for code | Free for code pass | Read `graphify-out/graph.json` or `GRIST_GRAPHIFY_PATH` |
| **CRG** ([tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph)) | MCP blast-radius + optional semantic search | Local; embeddings optional | MCP tools; stub until `GRIST_CRG=1` |

## Grist surface

- Algebra: `packages/opencode/src/grist/code-map/`
- Tool: `code_map` — seed + hops → compact subgraph for context minimization
- Env:
  - `GRIST_CODE_MAP=graphify|crg|off` (default `graphify`)
  - `GRIST_GRAPHIFY_PATH=/path/to/graph.json`
  - `GRIST_CRG=1` once CRG MCP is wired

## Bake-off method (Prosh)

1. Pin Prosh SHA.
2. Build Graphify code-only graph into `graphify-out/graph.json`.
3. Build CRG graph + wire MCP; set `GRIST_CRG=1`.
4. Run the same task battery through `scoreRetrieval` (see
   `code-map.test.ts` pattern): for each task, record hit-rate on expected
   symbols, prompt token estimate, latency.
5. Lock the winner on **token spend × retrieval quality** (not vibes).
6. Wire the winner into escalation context minimization (subgraph, not repo).

```bash
bun run --cwd packages/opencode test src/grist/code-map/
```

Fixture graph: `packages/opencode/src/grist/code-map/fixtures/mini-graph.json`.
