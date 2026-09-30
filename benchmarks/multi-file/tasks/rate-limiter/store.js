// store.js — in-memory hit store
class HitStore {
  constructor() {
    this.hits = new Map(); // key -> array of timestamps (ms)
  }
  record(key, now) {
    if (!this.hits.has(key)) this.hits.set(key, []);
    this.hits.get(key).push(now);
  }
  countSince(key, sinceMs, now) {
    const arr = this.hits.get(key) || [];
    // prune old entries
    const fresh = arr.filter((t) => t > now - sinceMs);
    this.hits.set(key, fresh);
    return fresh.length;
  }
  reset() {
    this.hits.clear();
  }
}

module.exports = { HitStore };
