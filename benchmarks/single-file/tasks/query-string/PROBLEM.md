# Task: query-string

Write a JavaScript module `solution.js` in this directory that exports two functions: `parseQuery(qs)` and `stringifyQuery(obj)`.

Rules:
- `parseQuery(qs)` parses a query string (with or without leading `?`) into an object.
  - Keys and values are `decodeURIComponent`-decoded.
  - A repeated key produces an array of values, in order.
  - A key with no `=` gets value `""`.
- `stringifyQuery(obj)` builds a query string (no leading `?`).
  - Keys and values are `encodeURIComponent`-encoded.
  - Array values produce repeated `key=value` pairs.
  - Keys are emitted in object insertion order.

Use CommonJS (`module.exports`). Do not modify `test.js`.
