const assert = require("node:assert");
const { dedupe } = require("./solution.js");

assert.deepStrictEqual(dedupe([1, 2, 2, 3, 1]), [1, 2, 3]);
assert.deepStrictEqual(dedupe([]), []);
assert.deepStrictEqual(dedupe(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
assert.deepStrictEqual(dedupe([NaN, NaN, 1]), [NaN, 1]);
assert.deepStrictEqual(dedupe([0, -0, 0]), [0]);
const input = [3, 1, 3];
assert.deepStrictEqual(dedupe(input), [3, 1]);
assert.deepStrictEqual(input, [3, 1, 3]);
console.log("dedupe: all tests passed");
