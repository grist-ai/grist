// cache.js — hardcoded constants (starter)
const MAX_SIZE = 100;
const TTL_MS = 60000;

function createCache() {
  return { maxSize: MAX_SIZE, ttlMs: TTL_MS, entries: new Map() };
}

module.exports = { createCache };
