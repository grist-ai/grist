# Task: deep-clone

Write a JavaScript module `solution.js` in this directory that exports a function `deepClone(v)`.

Rules:
- Returns a deep copy of `v`.
- Handles: plain objects, arrays, `Date`, `RegExp`, `Map`, `Set`.
- Circular references are preserved (the clone's cycle points to the cloned objects, not the originals).
- Prototypes other than the built-ins above need not be preserved (plain-object copy is fine).
- Functions are copied by reference.

Use CommonJS (`module.exports`). Do not modify `test.js`.
