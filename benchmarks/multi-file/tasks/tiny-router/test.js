const assert = require("node:assert");
const { Router } = require("./router");

// 1. middleware runs before handler, in order
{
  const r = new Router();
  const order = [];
  r.use((req, next) => { order.push("m1"); return next(); });
  r.use((req, next) => { order.push("m2"); return next(); });
  r.get("/x", () => { order.push("handler"); return { status: 200, body: "ok" }; });
  const res = r.handle({ method: "GET", path: "/x" });
  assert.deepStrictEqual(order, ["m1", "m2", "handler"]);
  assert.deepStrictEqual(res, { status: 200, body: "ok" });
}

// 2. middleware can short-circuit
{
  const r = new Router();
  let handlerRan = false;
  r.use(() => ({ status: 401, body: "denied" }));
  r.use((req, next) => { throw new Error("should not run"); });
  r.get("/x", () => { handlerRan = true; return { status: 200 }; });
  const res = r.handle({ method: "GET", path: "/x" });
  assert.deepStrictEqual(res, { status: 401, body: "denied" });
  assert.strictEqual(handlerRan, false);
}

// 3. middleware can modify req for downstream
{
  const r = new Router();
  r.use((req, next) => { req.user = "ada"; return next(); });
  r.get("/who", (req) => ({ status: 200, body: req.user }));
  const res = r.handle({ method: "GET", path: "/who" });
  assert.deepStrictEqual(res, { status: 200, body: "ada" });
}

// 4. middlewares run even on 404
{
  const r = new Router();
  let ran = false;
  r.use((req, next) => { ran = true; return next(); });
  const res = r.handle({ method: "GET", path: "/nope" });
  assert.strictEqual(ran, true);
  assert.deepStrictEqual(res, { status: 404, body: "not found" });
}

// 5. no middlewares: old behavior preserved
{
  const r = new Router();
  r.post("/p", (req) => ({ status: 201, body: req.data }));
  const res = r.handle({ method: "POST", path: "/p", data: "d" });
  assert.deepStrictEqual(res, { status: 201, body: "d" });
}

console.log("tiny-router: all tests passed");
