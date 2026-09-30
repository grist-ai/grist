# Task: topo-sort

Write a JavaScript module `solution.js` in this directory that exports a function `topoSort(nodes, edges)`.

Rules:
- `nodes` is an array of unique string ids. `edges` is an array of `[from, to]` pairs meaning `from` must come before `to`.
- Returns an array with all nodes in a valid topological order.
- Deterministic: when several nodes are available, pick the lexicographically smallest first.
- If the graph has a cycle, throw an `Error` whose message contains the word "cycle".
- Edges may reference nodes not in `nodes` — include them in the output.

Use CommonJS (`module.exports`). Do not modify `test.js`.
