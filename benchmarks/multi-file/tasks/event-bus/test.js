const assert = require("node:assert");
const { EventBus } = require("./bus");

// 1. exact still works
{
  const b = new EventBus();
  const got = [];
  b.subscribe("user.created", (p, t) => got.push([p, t]));
  const n = b.publish("user.created", { id: 1 });
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(got, [[{ id: 1 }, "user.created"]]);
}

// 2. "*" matches one level
{
  const b = new EventBus();
  const got = [];
  b.subscribe("user.*", (p, t) => got.push(t));
  b.publish("user.created", {});
  b.publish("user.deleted", {});
  b.publish("user.created.extra", {});
  assert.deepStrictEqual(got, ["user.created", "user.deleted"]);
}

// 3. trailing "#" matches any depth incl. prefix
{
  const b = new EventBus();
  const got = [];
  b.subscribe("order.#", (p, t) => got.push(t));
  b.publish("order", {});
  b.publish("order.shipped", {});
  b.publish("order.shipped.eu", {});
  b.publish("orders", {});
  assert.deepStrictEqual(got, ["order", "order.shipped", "order.shipped.eu"]);
}

// 4. exact + wildcard both fire; count is total invocations
{
  const b = new EventBus();
  let n = 0;
  b.subscribe("a.b", () => n++);
  b.subscribe("a.*", () => n++);
  b.subscribe("#", () => n++);
  const total = b.publish("a.b", {});
  assert.strictEqual(total, 3);
  assert.strictEqual(n, 3);
}

// 5. unsubscribe works with wildcards
{
  const b = new EventBus();
  let n = 0;
  const unsub = b.subscribe("user.*", () => n++);
  b.publish("user.created", {});
  unsub();
  const total = b.publish("user.created", {});
  assert.strictEqual(n, 1);
  assert.strictEqual(total, 0);
}

// 6. no subscribers -> 0
{
  const b = new EventBus();
  assert.strictEqual(b.publish("nothing.here", {}), 0);
}

console.log("event-bus: all tests passed");
