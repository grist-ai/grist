const assert = require("node:assert");
const { stringify } = require("./solution.js");

assert.strictEqual(stringify([["a", "b"], ["c", "d"]]), "a,b\nc,d\n");
assert.strictEqual(stringify([]), "");
assert.strictEqual(stringify([["a,b", 'q"q', "line\nbreak"]]), '"a,b","q""q","line\nbreak"\n');
assert.strictEqual(stringify([[1, null, undefined, true]]), "1,,," + "true\n");
assert.strictEqual(
  stringify([[1, 2]], { header: ["x", "y"] }),
  "x,y\n1,2\n"
);
assert.strictEqual(stringify([["a", "b"]], { delimiter: ";" }), "a;b\n");
assert.strictEqual(stringify([["a;b"]], { delimiter: ";" }), '"a;b"\n');
console.log("csv-stringify: all tests passed");
