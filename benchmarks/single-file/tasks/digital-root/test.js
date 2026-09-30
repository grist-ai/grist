const assert = require("node:assert");
const { digitalRoot } = require("./solution.js");

assert.strictEqual(digitalRoot(0), 0);
assert.strictEqual(digitalRoot(5), 5);
assert.strictEqual(digitalRoot(16), 7);
assert.strictEqual(digitalRoot(942), 6);
assert.strictEqual(digitalRoot(999999999), 9);
assert.strictEqual(digitalRoot(12345), 6);
console.log("digital-root: all tests passed");
