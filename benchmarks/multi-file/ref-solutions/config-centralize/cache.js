const { CONFIG } = require("./config");
function createCache() {
  return { maxSize: CONFIG.cache.maxSize, ttlMs: CONFIG.cache.ttlMs, entries: new Map() };
}
module.exports = { createCache };
