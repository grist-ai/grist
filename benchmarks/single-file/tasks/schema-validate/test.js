const assert = require("node:assert");
const { s } = require("./solution.js");

assert.deepStrictEqual(s.string().validate("a"), { ok: true });
assert.strictEqual(s.string().validate(1).ok, false);
assert.ok(s.string().validate(1).errors.length > 0);
assert.deepStrictEqual(s.number().validate(1.5), { ok: true });
assert.strictEqual(s.number().validate("1").ok, false);
assert.deepStrictEqual(s.boolean().validate(false), { ok: true });

const user = s.object({ name: s.string(), age: s.number().optional() });
assert.deepStrictEqual(user.validate({ name: "a" }), { ok: true });
assert.deepStrictEqual(user.validate({ name: "a", age: 3 }), { ok: true });
const bad = user.validate({ name: "a", age: "x" });
assert.strictEqual(bad.ok, false);
assert.ok(bad.errors.some((e) => e.includes("age")));
const missing = user.validate({});
assert.strictEqual(missing.ok, false);
assert.ok(missing.errors.some((e) => e.includes("name")));
assert.strictEqual(user.validate("nope").ok, false);

const nums = s.array(s.number());
assert.deepStrictEqual(nums.validate([1, 2]), { ok: true });
assert.strictEqual(nums.validate([1, "x"]).ok, false);
assert.strictEqual(nums.validate("nope").ok, false);

assert.deepStrictEqual(s.string().optional().validate(undefined), { ok: true });
console.log("schema-validate: all tests passed");
