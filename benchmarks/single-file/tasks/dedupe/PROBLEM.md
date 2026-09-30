# Task: dedupe

Write a JavaScript module `solution.js` in this directory that exports a function `dedupe(arr)`.

Rules:
- `dedupe(arr)` returns a new array with duplicate values removed, keeping the first occurrence of each value.
- Equality is `SameValueZero` (like `Array.prototype.includes`): `NaN` equals `NaN`, `+0` equals `-0`.
- The input array is not modified.

Use CommonJS (`module.exports`). Do not modify `test.js`.
