const assert = require("node:assert");
const { run } = require("./index");

assert.deepStrictEqual(run("z"), ["A(z)+B(z)", "B(z)+A(z)"]);

const { helperA, combinedA } = require("./a");
const { helperB, combinedB } = require("./b");
assert.strictEqual(helperA("q"), "A(q)");
assert.strictEqual(helperB("q"), "B(q)");
assert.strictEqual(combinedA("q"), "A(q)+B(q)");
assert.strictEqual(combinedB("q"), "B(q)+A(q)");

// helpers module exists (the extracted shared code)
const helpers = require("./helpers");
assert.strictEqual(typeof helpers.helperA, "function");
assert.strictEqual(typeof helpers.helperB, "function");

console.log("circular-dep: all tests passed");
