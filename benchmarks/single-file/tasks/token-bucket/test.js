const assert = require("node:assert");
const { TokenBucket } = require("./solution.js");

let now = 0;
const b = new TokenBucket(10, 1, () => now); // 1 token/sec
assert.strictEqual(b.take(10), true);
assert.strictEqual(b.take(1), false); // empty
now += 5500; // +5.5 tokens
assert.strictEqual(b.take(5), true);
assert.strictEqual(b.take(1), false); // 0.5 left
now += 100000; // refill capped at capacity
assert.strictEqual(b.take(10), true);
assert.strictEqual(b.take(1), false);
assert.strictEqual(b.take(0), true);

const b2 = new TokenBucket(5, 10, () => now);
assert.strictEqual(b2.take(3), true);
assert.strictEqual(b2.take(3), false); // only 2 left
console.log("token-bucket: all tests passed");
