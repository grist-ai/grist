# Task: promise-pool

Write a JavaScript module `solution.js` in this directory that exports a function `promisePool(tasks, n)`.

Rules:
- `tasks` is an array of functions, each returning a promise.
- At most `n` tasks run concurrently.
- The returned promise resolves to an array of results in the same order as `tasks`.
- If any task rejects, the returned promise rejects with that error (first rejection wins).
- `n` is a positive integer. Tasks start lazily (a task function is not called until a slot frees up).

Use CommonJS (`module.exports`). Do not modify `test.js`.
