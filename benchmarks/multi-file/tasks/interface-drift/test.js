const assert = require("node:assert");
const { describe } = require("./index");

assert.strictEqual(describe(7), "User7 (#7)");

const { getUserName, getUserId } = require("./consumer");
assert.strictEqual(getUserName(1), "User1");
assert.strictEqual(getUserId(2), 2);
assert.throws(() => getUserName(0), /fetch failed/);
assert.throws(() => getUserName(-5), /fetch failed/);

console.log("interface-drift: all tests passed");
