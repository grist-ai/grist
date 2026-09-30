const assert = require("node:assert");
const { memoize } = require("./solution.js");

let n = 0;
const add = memoize((a, b) => { n++; return a + b; });
assert.strictEqual(add(1, 2), 3);
assert.strictEqual(add(1, 2), 3);
assert.strictEqual(n, 1);
assert.strictEqual(add(2, 1), 3);
assert.strictEqual(n, 2); // different args, not cached
add.clear();
assert.strictEqual(add(1, 2), 3);
assert.strictEqual(n, 3);

// custom key fn
let m = 0;
const get = memoize((obj) => { m++; return obj.v; }, (obj) => obj.id);
assert.strictEqual(get({ id: "x", v: 1 }), 1);
assert.strictEqual(get({ id: "x", v: 2 }), 1); // same key -> cached
assert.strictEqual(m, 1);

// this forwarding
const o = { base: 10, f: memoize(function (x) { return this.base + x; }) };
assert.strictEqual(o.f(5), 15);
console.log("memoize: all tests passed");
