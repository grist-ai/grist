const assert = require("node:assert");
const { intersection } = require("./solution.js");

assert.deepStrictEqual(intersection([1, 2, 3], [2, 3, 4]), [2, 3]);
assert.deepStrictEqual(intersection([3, 2, 1, 2], [1, 2]), [2, 1]);
assert.deepStrictEqual(intersection([], [1]), []);
assert.deepStrictEqual(intersection([1], []), []);
assert.deepStrictEqual(intersection(["a", "b"], ["b", "c"]), ["b"]);
assert.deepStrictEqual(intersection([NaN], [NaN]), [NaN]);
console.log("intersection: all tests passed");
