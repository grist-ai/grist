// REFERENCE — rate-limiter/limiter.js
const { HitStore } = require("./store");

class RateLimiter {
  constructor({ maxHits, windowMs }) {
    this.maxHits = maxHits;
    this.windowMs = windowMs;
    this.store = new HitStore();
    this.routeLimits = new Map();
  }

  setRouteLimit(route, { maxHits, windowMs }) {
    this.routeLimits.set(route, { maxHits, windowMs });
  }

  check(req, now = Date.now()) {
    const route = req.route || "";
    const lim = this.routeLimits.get(route) || {
      maxHits: this.maxHits,
      windowMs: this.windowMs,
    };
    const key = `${req.ip || "global"}|${route}`;
    const count = this.store.countSince(key, lim.windowMs, now);
    if (count >= lim.maxHits) {
      const arr = this.store.hits.get(key) || [];
      const oldest = arr.length ? Math.min(...arr) : now;
      const retryAfterMs = Math.max(0, oldest + lim.windowMs - now);
      return { allowed: false, retryAfterMs };
    }
    this.store.record(key, now);
    return { allowed: true };
  }
}

module.exports = { RateLimiter };
