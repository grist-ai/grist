// REFERENCE — event-bus/bus.js
const { matchTopic } = require("./topics");

class EventBus {
  constructor() {
    this.subs = new Map();
  }
  subscribe(topic, fn) {
    if (!this.subs.has(topic)) this.subs.set(topic, new Set());
    this.subs.get(topic).add(fn);
    return () => this.subs.get(topic).delete(fn);
  }
  publish(topic, payload) {
    let n = 0;
    for (const [subTopic, set] of this.subs) {
      if (!matchTopic(subTopic, topic)) continue;
      for (const fn of set) {
        fn(payload, topic);
        n++;
      }
    }
    return n;
  }
}

module.exports = { EventBus };
