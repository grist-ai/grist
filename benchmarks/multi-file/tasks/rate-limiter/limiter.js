// limiter.js — rate limiter (starter code)
const { HitStore } = require("./store");

class RateLimiter {
  constructor({ maxHits, windowMs }) {
    this.maxHits = maxHits;
    this.windowMs = windowMs;
    this.store = new HitStore();
    this.routeLimits = new Map(); // route -> {maxHits, windowMs}
  }

  // TODO: add setRouteLimit(route, {maxHits, windowMs}).
  // TODO: check(req) uses the route-specific limit if set for req.route,
  //   else the default. Returns {allowed: true} or
  //   {allowed: false, retryAfterMs}.
  //   retryAfterMs = ms until the oldest hit in the window expires.
  check(req, now = Date.now()) {
    const key = req.ip || "global";
    const count = this.store.countSince(key, this.windowMs, now);
    if (count >= this.maxHits) {
      return { allowed: false, retryAfterMs: this.windowMs };
    }
    this.store.record(key, now);
    return { allowed: true };
  }
}

module.exports = { RateLimiter };
