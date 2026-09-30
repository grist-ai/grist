# Task: memoize

Write a JavaScript module `solution.js` in this directory that exports a function `memoize(fn, keyFn)`.

Rules:
- Returns a wrapped function that caches `fn`'s results.
- Default cache key: `JSON.stringify` of the arguments array.
- `keyFn(...args)` (optional) computes a custom string cache key.
- The wrapper exposes `.clear()` which empties the cache.
- `this` is forwarded to `fn`.

Use CommonJS (`module.exports`). Do not modify `test.js`.
