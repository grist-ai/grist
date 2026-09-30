const assert = require("node:assert");
const { EventEmitter } = require("./solution.js");

const ee = new EventEmitter();
const calls = [];
const l1 = (...a) => calls.push(["l1", ...a]);
const l2 = (...a) => calls.push(["l2", ...a]);
ee.on("e", l1).on("e", l2);
assert.strictEqual(ee.emit("e", 1, 2), 2);
assert.deepStrictEqual(calls, [["l1", 1, 2], ["l2", 1, 2]]);
assert.strictEqual(ee.emit("nope"), 0);
ee.off("e", l1);
calls.length = 0;
assert.strictEqual(ee.emit("e", 3), 1);
assert.deepStrictEqual(calls, [["l2", 3]]);

const ee2 = new EventEmitter();
let n = 0;
ee2.once("x", () => n++);
assert.strictEqual(ee2.emit("x"), 1);
assert.strictEqual(ee2.emit("x"), 0);
assert.strictEqual(n, 1);

// removing a non-registered listener is a no-op
ee2.off("x", () => {});
assert.strictEqual(ee2.emit("other"), 0);
console.log("event-emitter: all tests passed");
