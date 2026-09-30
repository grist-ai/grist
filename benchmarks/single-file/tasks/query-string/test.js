const assert = require("node:assert");
const { parseQuery, stringifyQuery } = require("./solution.js");

assert.deepStrictEqual(parseQuery("?a=1&b=2"), { a: "1", b: "2" });
assert.deepStrictEqual(parseQuery("a=1&a=2"), { a: ["1", "2"] });
assert.deepStrictEqual(parseQuery("flag"), { flag: "" });
assert.deepStrictEqual(parseQuery(""), {});
assert.deepStrictEqual(parseQuery("q=hello%20world"), { q: "hello world" });
assert.deepStrictEqual(parseQuery("a="), { a: "" });

assert.strictEqual(stringifyQuery({ a: "1", b: "2" }), "a=1&b=2");
assert.strictEqual(stringifyQuery({ a: ["1", "2"] }), "a=1&a=2");
assert.strictEqual(stringifyQuery({ q: "hello world" }), "q=hello%20world");
assert.strictEqual(stringifyQuery({}), "");
assert.strictEqual(stringifyQuery({ flag: "" }), "flag=");

// round-trip
const obj = { x: "1", y: ["a", "b c"] };
assert.deepStrictEqual(parseQuery(stringifyQuery(obj)), obj);
console.log("query-string: all tests passed");
