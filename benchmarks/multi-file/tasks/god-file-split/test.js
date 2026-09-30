const assert = require("node:assert");

// New modules exist and work standalone
const { UserStore } = require("./db");
const { formatUser, validateEmail } = require("./utils");
const { createRoutes } = require("./routes");

const store = new UserStore();
const u = store.add("Ada", "ada@x.com");
assert.strictEqual(u.id, 1);
assert.deepStrictEqual(store.get(1), u);
assert.strictEqual(store.get(999), null);
assert.deepStrictEqual(store.all(), [u]);

assert.strictEqual(validateEmail("a@b.com"), true);
assert.strictEqual(validateEmail("nope"), false);
assert.strictEqual(formatUser({ id: 7, name: "Bo", email: "bo@y.com" }), "#7 Bo <bo@y.com>");

const routes = createRoutes(store);
assert.deepStrictEqual(routes.getUser(1), { status: 200, body: "#1 Ada <ada@x.com>" });
assert.deepStrictEqual(routes.getUser(999), { status: 404, body: "not found" });
assert.deepStrictEqual(routes.createUser("Cy", "cy@z.com"), {
  status: 201,
  body: "#2 Cy <cy@z.com>",
});
assert.deepStrictEqual(routes.createUser("Bad", "not-an-email"), {
  status: 400,
  body: "bad email",
});

// app.js re-exports everything (backward compat)
const app = require("./app");
assert.strictEqual(typeof app.UserStore, "function");
assert.strictEqual(typeof app.validateEmail, "function");
assert.strictEqual(typeof app.formatUser, "function");
assert.strictEqual(typeof app.createRoutes, "function");
const store2 = new app.UserStore();
const routes2 = app.createRoutes(store2);
assert.deepStrictEqual(routes2.createUser("Dee", "dee@w.com"), {
  status: 201,
  body: "#1 Dee <dee@w.com>",
});

console.log("god-file-split: all tests passed");
