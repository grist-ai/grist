# Task: json-path

Write a JavaScript module `solution.js` in this directory that exports a function `jsonPath(obj, path)`.

Rules:
- `path` uses dot notation and bracket indices: `"a.b[0].c"`, `"a[1]"`, `"a.b"`.
- Returns the value at that path, or `undefined` if any step is missing (no throw).
- Numeric bracket segments index into arrays; on a plain object a bracket segment does a string-key lookup (`obj[String(n)]`).
- A quoted-bracket form is NOT required — only `name`, `name[idx]`, and `[idx]` segments.

Use CommonJS (`module.exports`). Do not modify `test.js`.
