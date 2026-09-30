const assert = require("node:assert");
const { reverseWords } = require("./solution.js");

assert.strictEqual(reverseWords("hello world"), "olleh dlrow");
assert.strictEqual(reverseWords("a  b"), "a  b");
assert.strictEqual(reverseWords(""), "");
assert.strictEqual(reverseWords("abc"), "cba");
assert.strictEqual(reverseWords("  hi "), "  ih ");
assert.strictEqual(reverseWords("Node.js rocks!"), "sj.edoN !skcor");
console.log("reverse-words: all tests passed");
