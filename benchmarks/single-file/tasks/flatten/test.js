const assert = require("node:assert");
const { flatten } = require("./solution.js");

assert.deepStrictEqual(flatten([1, [2, [3, [4]], 5]]), [1, 2, 3, 4, 5]);
assert.deepStrictEqual(flatten([]), []);
assert.deepStrictEqual(flatten([1, 2, 3]), [1, 2, 3]);
assert.deepStrictEqual(flatten([[], [[], []], 1]), [1]);
assert.deepStrictEqual(flatten(["a", ["b", ["c"]]]), ["a", "b", "c"]);
const input = [1, [2, 3]];
const out = flatten(input);
assert.deepStrictEqual(input, [1, [2, 3]]);
assert.deepStrictEqual(out, [1, 2, 3]);
assert.deepStrictEqual(flatten([null, [undefined, [true]]]), [null, undefined, true]);
console.log("flatten: all tests passed");
