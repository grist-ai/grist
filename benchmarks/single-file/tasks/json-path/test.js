const assert = require("node:assert");
const { jsonPath } = require("./solution.js");

const obj = { a: { b: [{ c: 1 }, { c: 2 }], d: "x" }, e: [10, 20] };
assert.strictEqual(jsonPath(obj, "a.b[0].c"), 1);
assert.strictEqual(jsonPath(obj, "a.b[1].c"), 2);
assert.strictEqual(jsonPath(obj, "a.d"), "x");
assert.strictEqual(jsonPath(obj, "e[1]"), 20);
assert.strictEqual(jsonPath(obj, "a.b[5].c"), undefined);
assert.strictEqual(jsonPath(obj, "a.missing.deep"), undefined);
assert.strictEqual(jsonPath(obj, "nope"), undefined);
assert.deepStrictEqual(jsonPath(obj, "a.b"), [{ c: 1 }, { c: 2 }]);
assert.strictEqual(jsonPath({ "0": "zero" }, "[0]"), "zero"); // bracket on object = string-key lookup
assert.strictEqual(jsonPath([1, 2, 3], "[1]"), 2);
console.log("json-path: all tests passed");
