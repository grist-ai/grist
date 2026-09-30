const assert = require("node:assert");
const { LRUCache } = require("./solution.js");

const c = new LRUCache(2);
c.put(1, 1); c.put(2, 2);
assert.strictEqual(c.get(1), 1);
c.put(3, 3);                    // evicts key 2
assert.strictEqual(c.get(2), -1);
c.put(4, 4);                    // evicts key 1
assert.strictEqual(c.get(1), -1);
assert.strictEqual(c.get(3), 3);
assert.strictEqual(c.get(4), 4);

const d = new LRUCache(1);
d.put("a", 10);
assert.strictEqual(d.get("a"), 10);
d.put("b", 20);
assert.strictEqual(d.get("a"), -1);
assert.strictEqual(d.get("b"), 20);

const e = new LRUCache(3);
e.put(1, 1); e.put(2, 2); e.put(3, 3);
e.get(1);                        // 1 now MRU; order LRU->MRU: 2,3,1
e.put(4, 4);                     // evicts 2
assert.strictEqual(e.get(2), -1);
assert.strictEqual(e.get(1), 1);
e.put(3, 30);                    // update existing, no eviction
assert.strictEqual(e.get(3), 30);
assert.strictEqual(e.get(4), 4);

// rough perf sanity: 50k ops should be fast (catches O(n) implementations)
const p = new LRUCache(1000);
const t0 = Date.now();
for (let i = 0; i < 50000; i++) { p.put(i % 2000, i); p.get(i % 2000); }
assert.ok(Date.now() - t0 < 3000, "too slow — likely not O(1)");

console.log("lru-cache: all tests passed");
