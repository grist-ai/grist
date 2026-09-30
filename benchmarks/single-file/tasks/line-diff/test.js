const assert = require("node:assert");
const { diffLines } = require("./solution.js");

// helper: verify ops transform a into b
function applyOps(a, ops) {
  const out = [];
  let i = 0;
  for (const op of ops) {
    if (op.type === "same") { assert.strictEqual(a[i], op.line); out.push(op.line); i++; }
    else if (op.type === "del") { assert.strictEqual(a[i], op.line); i++; }
    else if (op.type === "add") { out.push(op.line); }
    else throw new Error("bad op type " + op.type);
  }
  assert.strictEqual(i, a.length, "ops must consume all of a");
  return out;
}
function check(a, b) {
  const ops = diffLines(a, b);
  assert.deepStrictEqual(applyOps(a, ops), b);
  return ops;
}

assert.deepStrictEqual(check([], []), []);
assert.deepStrictEqual(check(["a"], ["a"]), [{ type: "same", line: "a" }]);

const ops = check(["a", "b", "c"], ["a", "x", "c"]);
assert.deepStrictEqual(ops, [
  { type: "same", line: "a" },
  { type: "del", line: "b" },
  { type: "add", line: "x" },
  { type: "same", line: "c" },
]);

check(["a", "b"], ["x", "y", "z"]);
check(["x", "y", "z"], ["a", "b"]);
check(["a", "a", "b"], ["a", "b", "b"]); // repeats resolve deterministically
console.log("line-diff: all tests passed");
