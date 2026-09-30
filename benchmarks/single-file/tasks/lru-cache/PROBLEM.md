# Task: lru-cache

Write a JavaScript module `solution.js` in this directory that exports a class `LRUCache`.

Rules:
- `new LRUCache(capacity)` — capacity is a positive integer.
- `get(key)` returns the value, or `-1` if absent. Accessing a key marks it most-recently-used.
- `put(key, value)` inserts or updates. If over capacity, evicts the least-recently-used key.
- Keys and values: keys are strings or numbers; values are numbers.
- `get` and `put` must run in O(1) average time (use a Map + ordering; do not use arrays with indexOf/splice on the hot path in a way that breaks O(1) — a plain Map relying on insertion order is the intended approach).

Use CommonJS (`module.exports`). Do not modify `test.js`.
