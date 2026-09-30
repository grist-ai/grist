const assert = require("node:assert");
const { topoSort } = require("./solution.js");

assert.deepStrictEqual(topoSort(["a", "b", "c"], [["a", "b"], ["b", "c"]]), ["a", "b", "c"]);
assert.deepStrictEqual(topoSort(["b", "a"], []), ["a", "b"]); // lexicographic
assert.deepStrictEqual(
  topoSort(["a", "b", "c", "d"], [["a", "d"], ["b", "d"]]),
  ["a", "b", "c", "d"]
);
// validity on a diamond: a before b,c; b,c before d
const r = topoSort(["a", "b", "c", "d"], [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]);
assert.ok(r.indexOf("a") < r.indexOf("b") && r.indexOf("a") < r.indexOf("c"));
assert.ok(r.indexOf("b") < r.indexOf("d") && r.indexOf("c") < r.indexOf("d"));
assert.strictEqual(r.length, 4);

assert.throws(() => topoSort(["a", "b"], [["a", "b"], ["b", "a"]]), /cycle/);
assert.throws(() => topoSort(["a"], [["a", "a"]]), /cycle/);

// edge-only nodes are included
assert.deepStrictEqual(topoSort(["a"], [["a", "z"]]), ["a", "z"]);
console.log("topo-sort: all tests passed");
