# Task: ttl-cache

Write a JavaScript module `solution.js` in this directory that exports a class `TTLCache`.

Rules:
- `new TTLCache(nowFn)` — `nowFn` returns current time in ms (defaults to `Date.now`).
- `set(key, value, ttlMs)` — stores `value` expiring `ttlMs` ms from now. Overwrites existing.
- `get(key)` — returns the value, or `undefined` if missing or expired.
- `delete(key)` — removes the entry. Returns `true` if an entry existed (even if expired), else `false`.
- `size()` — number of live (unexpired) entries. Expired entries are purged lazily on access/size.
- `ttlMs <= 0` means the entry is already expired.

Use CommonJS (`module.exports`). Do not modify `test.js`.
