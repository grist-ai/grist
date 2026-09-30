const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// config module has the right shape
const { CONFIG } = require("./config");
assert.deepStrictEqual(CONFIG, {
  db: { maxConnections: 10, timeoutMs: 5000 },
  cache: { maxSize: 100, ttlMs: 60000 },
  api: { port: 3000, rateLimit: 100 },
  worker: { concurrency: 4, retryMs: 1000 },
});

// modules behave identically
assert.deepStrictEqual(require("./db").connect(), {
  maxConnections: 10,
  timeoutMs: 5000,
});
const cache = require("./cache").createCache();
assert.strictEqual(cache.maxSize, 100);
assert.strictEqual(cache.ttlMs, 60000);
assert.ok(cache.entries instanceof Map);
assert.deepStrictEqual(require("./api").start(), { port: 3000, rateLimit: 100 });
assert.deepStrictEqual(require("./worker").spawn(), { concurrency: 4, retryMs: 1000 });

// no hardcoded constants left in the four modules
const constRe = /\b(MAX_CONNECTIONS|TIMEOUT_MS|MAX_SIZE|TTL_MS|PORT|RATE_LIMIT|CONCURRENCY|RETRY_MS)\b/;
for (const f of ["db.js", "cache.js", "api.js", "worker.js"]) {
  const src = fs.readFileSync(path.join(__dirname, f), "utf8");
  assert.ok(!constRe.test(src), `${f} still has hardcoded constants`);
  assert.ok(src.includes('require("./config")'), `${f} does not import config`);
}

console.log("config-centralize: all tests passed");
