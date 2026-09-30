const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// validators module exists with the right functions
const v = require("./validators");
for (const fn of ["isNonEmptyString", "isEmail", "isPositiveInt", "isPositiveNumber", "isSku"]) {
  assert.strictEqual(typeof v[fn], "function", `missing ${fn}`);
}
assert.strictEqual(v.isNonEmptyString("  x "), true);
assert.strictEqual(v.isNonEmptyString("   "), false);
assert.strictEqual(v.isNonEmptyString(42), false);
assert.strictEqual(v.isEmail("a@b.com"), true);
assert.strictEqual(v.isEmail("bad"), false);
assert.strictEqual(v.isPositiveInt(3), true);
assert.strictEqual(v.isPositiveInt(0), false);
assert.strictEqual(v.isPositiveInt(2.5), false);
assert.strictEqual(v.isPositiveNumber(0.5), true);
assert.strictEqual(v.isPositiveNumber(NaN), false);
assert.strictEqual(v.isPositiveNumber(-1), false);
assert.strictEqual(v.isSku("AB-123"), true);
assert.strictEqual(v.isSku("ABCDE-123"), false);
assert.strictEqual(v.isSku("ab-123"), false);

// services still behave identically
const { createUser } = require("./user-service");
assert.deepStrictEqual(createUser("Ada", "ada@x.com"), { name: "Ada", email: "ada@x.com" });
assert.deepStrictEqual(createUser("  Bo  ", "bo@y.com"), { name: "Bo", email: "bo@y.com" });
assert.throws(() => createUser("", "a@b.com"), /invalid name/);
assert.throws(() => createUser("x", "bad"), /invalid email/);

const { createOrder } = require("./order-service");
assert.deepStrictEqual(createOrder(1, 9.99), { userId: 1, amount: 9.99 });
assert.throws(() => createOrder(0, 5), /invalid userId/);
assert.throws(() => createOrder(1, -5), /invalid amount/);
assert.throws(() => createOrder(1, NaN), /invalid amount/);

const { createProduct } = require("./product-service");
assert.deepStrictEqual(createProduct("AB-123", 4.5), { sku: "AB-123", price: 4.5 });
assert.throws(() => createProduct("bad", 4.5), /invalid sku/);
assert.throws(() => createProduct("AB-123", 0), /invalid price/);

// services actually import from validators (no inline regexes left)
for (const f of ["user-service.js", "order-service.js", "product-service.js"]) {
  const src = fs.readFileSync(path.join(__dirname, f), "utf8");
  assert.ok(src.includes('require("./validators")'), `${f} does not import validators`);
  assert.ok(!src.includes("[^\\s@]"), `${f} still has inline email regex`);
}

console.log("extract-validators: all tests passed");
