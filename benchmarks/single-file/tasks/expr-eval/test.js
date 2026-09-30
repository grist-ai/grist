const assert = require("node:assert");
const { evaluate } = require("./solution.js");

assert.strictEqual(evaluate("2 + 3 * 4"), 14);
assert.strictEqual(evaluate("(2 + 3) * 4"), 20);
assert.strictEqual(evaluate("2^3^2"), 512); // right-assoc: 2^(3^2)
assert.strictEqual(evaluate("-3 + 5"), 2);
assert.strictEqual(evaluate("--3"), 3);
assert.strictEqual(evaluate("-(2+1) * 2"), -6);
assert.strictEqual(evaluate("10 / 4"), 2.5);
assert.strictEqual(evaluate("  3.5  *  2 "), 7);
assert.strictEqual(evaluate("1/0"), Infinity);
assert.strictEqual(evaluate("2 * -3"), -6);
assert.throws(() => evaluate(""), Error);
assert.throws(() => evaluate("2 +"), Error);
assert.throws(() => evaluate("(2+3"), Error);
assert.throws(() => evaluate("2 & 3"), Error);
console.log("expr-eval: all tests passed");
