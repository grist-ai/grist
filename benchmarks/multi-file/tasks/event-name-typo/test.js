const assert = require("node:assert");
const { scenario } = require("./index");

const events = scenario();
assert.strictEqual(events.length, 2);
assert.deepStrictEqual(events[0], { type: "user", user: { id: 1, name: "Ada" } });
assert.deepStrictEqual(events[1], { type: "order", order: { id: 99 } });

console.log("event-name-typo: all tests passed");
