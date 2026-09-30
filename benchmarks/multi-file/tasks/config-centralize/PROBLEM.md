# Task: config-centralize — centralize hardcoded constants

Four modules each hardcode their own constants. Centralize them:

1. Create `config.js` exporting a single `CONFIG` object:
   ```js
   {
     db: { maxConnections: 10, timeoutMs: 5000 },
     cache: { maxSize: 100, ttlMs: 60000 },
     api: { port: 3000, rateLimit: 100 },
     worker: { concurrency: 4, retryMs: 1000 },
   }
   ```
2. Rewrite `db.js`, `cache.js`, `api.js`, `worker.js` to import `CONFIG`
   from `./config` and use its values. Remove the hardcoded constants.
3. Behavior must be identical (same returned values).

Do not modify `test.js`.
