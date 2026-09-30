# Task: debounce

Write a JavaScript module `solution.js` in this directory that exports a function `debounce(fn, ms)`.

Rules:
- `debounce(fn, ms)` returns a debounced function with trailing-edge semantics: `fn` is called `ms` milliseconds after the last invocation, with the latest arguments and `this`.
- The returned function has:
  - `.cancel()` — cancels any pending invocation.
  - `.flush()` — immediately invokes the pending call (if any) with the latest args, and returns `fn`'s return value (or `undefined` if nothing pending).
- `fn` is never called synchronously by the wrapper.

Use CommonJS (`module.exports`). Do not modify `test.js`.
