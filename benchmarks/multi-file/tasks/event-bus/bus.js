// bus.js — event bus (starter code)
class EventBus {
  constructor() {
    this.subs = new Map(); // topic -> Set<fn>
  }
  subscribe(topic, fn) {
    if (!this.subs.has(topic)) this.subs.set(topic, new Set());
    this.subs.get(topic).add(fn);
    return () => this.subs.get(topic).delete(fn);
  }
  publish(topic, payload) {
    // TODO: also deliver to wildcard subscriptions (see topics.js)
    const set = this.subs.get(topic);
    if (!set) return 0;
    let n = 0;
    for (const fn of set) {
      fn(payload, topic);
      n++;
    }
    return n;
  }
}

module.exports = { EventBus };
