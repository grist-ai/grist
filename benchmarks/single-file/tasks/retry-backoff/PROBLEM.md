# Task: retry-backoff

Write a JavaScript module `solution.js` in this directory that exports an async function `retry(fn, options)`.

Rules:
- `fn(attempt)` is an async function; `attempt` starts at 0 and increments per try.
- `options = { maxAttempts = 3, baseDelayMs = 100, factor = 2 }`.
- Call `fn` until it resolves, or until `maxAttempts` total attempts are used.
- Between attempts, wait `baseDelayMs * factor^(attempt)` ms, where `attempt` is the 0-based index of the attempt that just failed (so first wait is `baseDelayMs`).
- Return the resolved value of `fn`.
- If all attempts fail, throw the last error.
- `maxAttempts = 1` means try once, never wait.
- Do not use any npm packages; `setTimeout` is fine.

Use CommonJS (`module.exports`). Do not modify `test.js`.
