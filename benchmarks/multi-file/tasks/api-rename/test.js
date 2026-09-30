const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// New name works
const { fetchUser, getUsers } = require("./api");
assert.deepStrictEqual(fetchUser(5), { id: 5, name: "User5" });
assert.deepStrictEqual(getUsers([1, 2]), [
  { id: 1, name: "User1" },
  { id: 2, name: "User2" },
]);

// Handlers still work end to end
const { handleGetUser } = require("./handlers");
assert.deepStrictEqual(handleGetUser({ id: 3 }), {
  status: 200,
  body: { id: 3, name: "User3" },
});
const { handleBatch } = require("./batch");
assert.deepStrictEqual(handleBatch({ ids: [1] }), {
  status: 200,
  body: [{ id: 1, name: "User1" }],
});
const { main } = require("./index");
const out = main();
assert.strictEqual(out.one.body.name, "User1");
assert.strictEqual(out.many.body.length, 2);

// Old name is gone from source files (not test/problem).
// \bgetUser\b does not match getUsers (no word boundary before "s").
for (const f of ["api.js", "handlers.js", "batch.js", "index.js"]) {
  const src = fs.readFileSync(path.join(__dirname, f), "utf8");
  assert.ok(
    !/\bgetUser\b/.test(src),
    `${f} still references getUser`
  );
}

console.log("api-rename: all tests passed");
