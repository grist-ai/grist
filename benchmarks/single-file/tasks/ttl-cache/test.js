const assert = require("node:assert");
const { TTLCache } = require("./solution.js");

let now = 1000;
const c = new TTLCache(() => now);
c.set("a", 1, 100);
c.set("b", 2, 500);
assert.strictEqual(c.get("a"), 1);
assert.strictEqual(c.size(), 2);
now += 150;
assert.strictEqual(c.get("a"), undefined); // expired
assert.strictEqual(c.get("b"), 2);
assert.strictEqual(c.size(), 1); // lazy purge
assert.strictEqual(c.delete("a"), false); // already purged by the get() above
// delete of an expired-but-never-accessed entry returns true
c.set("d", 4, 50);
now += 100;
assert.strictEqual(c.delete("d"), true); // expired, not yet purged
assert.strictEqual(c.delete("d"), false);
assert.strictEqual(c.delete("zzz"), false);

c.set("c", 3, 0);
assert.strictEqual(c.get("c"), undefined);
assert.strictEqual(c.size(), 1);

c.set("b", 99, 1000); // overwrite
assert.strictEqual(c.get("b"), 99);
console.log("ttl-cache: all tests passed");
