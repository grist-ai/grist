const assert = require("node:assert");
const { deepClone } = require("./solution.js");

const src = { a: 1, b: [2, { c: 3 }], d: new Date(1000), r: /x+/gi, m: new Map([["k", 1]]), s: new Set([1, 2]) };
const c = deepClone(src);
assert.deepStrictEqual(c, src);
assert.notStrictEqual(c, src);
assert.notStrictEqual(c.b, src.b);
assert.notStrictEqual(c.d, src.d);
assert.ok(c.d instanceof Date);
assert.ok(c.r instanceof RegExp && c.r.source === "x+" && c.r.flags === "gi");
assert.ok(c.m instanceof Map && c.m.get("k") === 1 && c.m !== src.m);
assert.ok(c.s instanceof Set && c.s.has(2) && c.s !== src.s);

// cycles
const cyc = { name: "loop" };
cyc.self = cyc;
const c2 = deepClone(cyc);
assert.strictEqual(c2.self, c2);
assert.notStrictEqual(c2, cyc);

// primitives and functions
assert.strictEqual(deepClone(5), 5);
assert.strictEqual(deepClone("x"), "x");
assert.strictEqual(deepClone(null), null);
const fn = () => 1;
assert.strictEqual(deepClone({ fn }).fn, fn);

// mutation isolation
c.b[1].c = 999;
assert.strictEqual(src.b[1].c, 3);
console.log("deep-clone: all tests passed");
