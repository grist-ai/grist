const assert = require("node:assert");
const { chunk } = require("./solution.js");

assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.deepStrictEqual(chunk([1, 2, 3], 3), [[1, 2, 3]]);
assert.deepStrictEqual(chunk([1, 2], 5), [[1, 2]]);
assert.deepStrictEqual(chunk([], 2), []);
assert.deepStrictEqual(chunk([1, 2, 3], 0), []);
assert.deepStrictEqual(chunk([1, 2, 3], -1), []);
assert.deepStrictEqual(chunk([1, 2, 3, 4], 1), [[1], [2], [3], [4]]);
console.log("chunk: all tests passed");
