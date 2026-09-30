const assert = require("node:assert");
const { BST } = require("./solution.js");

const t = new BST();
assert.strictEqual(t.size(), 0);
assert.deepStrictEqual(t.inorder(), []);
t.insert(5).insert(3).insert(7).insert(3).insert(1);
assert.strictEqual(t.size(), 4);
assert.deepStrictEqual(t.inorder(), [1, 3, 5, 7]);
assert.strictEqual(t.has(7), true);
assert.strictEqual(t.has(4), false);
assert.strictEqual(t.has(1), true);

const t2 = new BST();
[10, 5, 15, 3, 7, 12, 20].forEach((v) => t2.insert(v));
assert.deepStrictEqual(t2.inorder(), [3, 5, 7, 10, 12, 15, 20]);
console.log("bst: all tests passed");
