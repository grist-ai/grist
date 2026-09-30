const assert = require("node:assert");
const { Router } = require("./solution.js");

const hUsers = () => "users";
const hUser = () => "user";
const r = new Router();
r.get("/users/:id", hUser);
r.get("/users/list", hUsers); // static registered AFTER param route
r.post("/users", hUsers);

let m = r.handle("GET", "/users/list");
assert.strictEqual(m.handler, hUsers); // static wins
assert.deepStrictEqual(m.params, {});

m = r.handle("get", "/users/42");
assert.strictEqual(m.handler, hUser);
assert.deepStrictEqual(m.params, { id: "42" });

m = r.handle("POST", "/users");
assert.strictEqual(m.handler, hUsers);

assert.strictEqual(r.handle("DELETE", "/users"), null);
assert.strictEqual(r.handle("GET", "/users"), null);
assert.strictEqual(r.handle("GET", "/users/42/posts"), null); // no partial match
assert.strictEqual(r.handle("GET", "/"), null);

// multi-param
const r2 = new Router();
const h = () => 1;
r2.get("/a/:x/b/:y", h);
const m2 = r2.handle("GET", "/a/1/b/2");
assert.deepStrictEqual(m2.params, { x: "1", y: "2" });
console.log("tiny-router: all tests passed");
