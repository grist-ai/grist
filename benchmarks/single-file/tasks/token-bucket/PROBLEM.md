# Task: token-bucket

Write a JavaScript module `solution.js` in this directory that exports a class `TokenBucket`.

Rules:
- `new TokenBucket(capacity, refillPerSec, nowFn)` — `nowFn` returns current time in ms (defaults to `Date.now`).
- `take(n = 1)` — if at least `n` tokens are available, consumes them and returns `true`; otherwise returns `false` and consumes nothing.
- Tokens refill continuously at `refillPerSec` tokens/second, capped at `capacity`. The bucket starts full.
- `take(0)` always returns `true` and consumes nothing.

Use CommonJS (`module.exports`). Do not modify `test.js`.
