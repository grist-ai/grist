# Task: tiny-router

Write a JavaScript module `solution.js` in this directory that exports a class `Router`.

Rules:
- `get(path, handler)` / `post(path, handler)` — register a handler for a method + path. Returns `this`.
- `handle(method, path)` — returns `{ handler, params }` for the first matching route, or `null` if none matches.
- Path segments starting with `:` are parameters (match any single non-empty segment): `/users/:id` matches `/users/42` with `params = { id: "42" }`.
- Exact (static) routes take priority over parameterized routes registered for the same method, regardless of registration order.
- Method matching is case-insensitive (`"GET"` matches `"get"`). Paths must match fully (no partial/prefix matches).

Use CommonJS (`module.exports`). Do not modify `test.js`.
