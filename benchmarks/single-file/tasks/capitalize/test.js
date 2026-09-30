const assert = require("node:assert");
const { capitalizeWords } = require("./solution.js");

assert.strictEqual(capitalizeWords("hello world"), "Hello World");
assert.strictEqual(capitalizeWords(""), "");
assert.strictEqual(capitalizeWords("a"), "A");
assert.strictEqual(capitalizeWords("hELLO wORLD"), "HELLO WORLD");
assert.strictEqual(capitalizeWords("  spaced"), "  Spaced");
console.log("capitalize: all tests passed");
