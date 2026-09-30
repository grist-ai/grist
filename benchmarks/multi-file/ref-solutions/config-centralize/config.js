// config.js
const CONFIG = {
  db: { maxConnections: 10, timeoutMs: 5000 },
  cache: { maxSize: 100, ttlMs: 60000 },
  api: { port: 3000, rateLimit: 100 },
  worker: { concurrency: 4, retryMs: 1000 },
};

module.exports = { CONFIG };
