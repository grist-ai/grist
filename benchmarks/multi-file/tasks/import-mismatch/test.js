const assert = require("node:assert");
const { summarize } = require("./index");

const out = summarize();
assert.deepStrictEqual(out, { total: 3, items: [1, 2, 3] });

const { getTotal, getItems } = require("./consumer");
assert.strictEqual(getTotal(), 3);
assert.deepStrictEqual(getItems(), [1, 2, 3]);

console.log("import-mismatch: all tests passed");
