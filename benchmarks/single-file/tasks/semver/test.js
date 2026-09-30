const assert = require("node:assert");
const { compareSemver } = require("./solution.js");

assert.strictEqual(compareSemver("1.0.0", "2.0.0"), -1);
assert.strictEqual(compareSemver("2.0.0", "1.0.0"), 1);
assert.strictEqual(compareSemver("1.2.3", "1.2.3"), 0);
assert.strictEqual(compareSemver("1.10.0", "1.2.0"), 1);
assert.strictEqual(compareSemver("1.0.0-alpha", "1.0.0"), -1);
assert.strictEqual(compareSemver("1.0.0", "1.0.0-alpha"), 1);
assert.strictEqual(compareSemver("1.0.0-alpha", "1.0.0-alpha.1"), -1);
assert.strictEqual(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
assert.strictEqual(compareSemver("1.0.0-alpha.beta", "1.0.0-beta"), -1);
assert.strictEqual(compareSemver("1.0.0+build.1", "1.0.0"), 0);
assert.strictEqual(compareSemver("1.0.0-alpha+001", "1.0.0-alpha"), 0);
assert.strictEqual(compareSemver("2.1.1", "2.1.0"), 1);
console.log("semver: all tests passed");
