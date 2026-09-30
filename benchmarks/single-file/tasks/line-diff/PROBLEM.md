# Task: line-diff

Write a JavaScript module `solution.js` in this directory that exports a function `diffLines(a, b)`.

Rules:
- `a` and `b` are arrays of strings (lines).
- Returns an array of ops `{ type, line }` where `type` is `"same"`, `"add"`, or `"del"`.
- Applying the ops in order reconstructs the transformation: deleting `"del"` lines from `a` and inserting `"add"` lines yields `b`.
- Use a longest-common-subsequence (LCS) based diff; when several minimal diffs exist, prefer the one that emits deletions before additions at each hunk (deterministic).
- Empty inputs are handled (`diffLines([], [])` → `[]`).

Use CommonJS (`module.exports`). Do not modify `test.js`.
