const assert = require("node:assert");
const { areAnagrams } = require("./solution.js");

assert.strictEqual(areAnagrams("listen", "silent"), true);
assert.strictEqual(areAnagrams("Listen", "Silent"), true);
assert.strictEqual(areAnagrams("hello world", "world hello"), true);
assert.strictEqual(areAnagrams("hello", "helloo"), false);
assert.strictEqual(areAnagrams("abc", "abd"), false);
assert.strictEqual(areAnagrams("", ""), true);
assert.strictEqual(areAnagrams("a!", "!a"), true);
assert.strictEqual(areAnagrams("a!", "a?"), false);
console.log("anagram: all tests passed");
