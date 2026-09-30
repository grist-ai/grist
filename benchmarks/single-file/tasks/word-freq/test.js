const assert = require("node:assert");
const { wordFreq } = require("./solution.js");

assert.deepStrictEqual(wordFreq("Hello hello world"), { hello: 2, world: 1 });
assert.deepStrictEqual(wordFreq("one, two; three: one!"), { one: 2, two: 1, three: 1 });
assert.deepStrictEqual(wordFreq(""), {});
assert.deepStrictEqual(wordFreq("... !!!"), {});
assert.deepStrictEqual(wordFreq("a1 b2 a1"), { a1: 2, b2: 1 });
assert.deepStrictEqual(wordFreq("  spaced   out  "), { spaced: 1, out: 1 });
console.log("word-freq: all tests passed");
