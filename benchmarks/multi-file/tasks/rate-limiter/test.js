const assert = require("node:assert");
const { RateLimiter } = require("./limiter");

// 1. default limit still works
{
  const l = new RateLimiter({ maxHits: 2, windowMs: 1000 });
  const req = { ip: "1.1.1.1", route: "/x" };
  assert.deepStrictEqual(l.check(req, 0), { allowed: true });
  assert.deepStrictEqual(l.check(req, 10), { allowed: true });
  const denied = l.check(req, 20);
  assert.strictEqual(denied.allowed, false);
  assert.ok(denied.retryAfterMs >= 0);
}

// 2. per-route limit overrides default
{
  const l = new RateLimiter({ maxHits: 100, windowMs: 1000 });
  l.setRouteLimit("/strict", { maxHits: 1, windowMs: 5000 });
  const strict = { ip: "2.2.2.2", route: "/strict" };
  const loose = { ip: "2.2.2.2", route: "/loose" };
  assert.deepStrictEqual(l.check(strict, 0), { allowed: true });
  assert.strictEqual(l.check(strict, 10).allowed, false);
  // /loose still uses the generous default
  assert.deepStrictEqual(l.check(loose, 20), { allowed: true });
  assert.deepStrictEqual(l.check(loose, 30), { allowed: true });
}

// 3. routes are isolated (same IP, different routes)
{
  const l = new RateLimiter({ maxHits: 1, windowMs: 1000 });
  assert.deepStrictEqual(l.check({ ip: "3.3.3.3", route: "/a" }, 0), { allowed: true });
  assert.deepStrictEqual(l.check({ ip: "3.3.3.3", route: "/b" }, 10), { allowed: true });
  assert.strictEqual(l.check({ ip: "3.3.3.3", route: "/a" }, 20).allowed, false);
}

// 4. retryAfterMs reflects oldest hit in window
{
  const l = new RateLimiter({ maxHits: 1, windowMs: 1000 });
  const req = { ip: "4.4.4.4", route: "/x" };
  l.check(req, 100); // hit at t=100
  const denied = l.check(req, 600); // t=600, window is [−400, 600]
  assert.strictEqual(denied.allowed, false);
  // oldest hit at 100 expires at 1100; now=600 -> 500ms
  assert.strictEqual(denied.retryAfterMs, 500);
}

// 5. window expiry allows again
{
  const l = new RateLimiter({ maxHits: 1, windowMs: 1000 });
  const req = { ip: "5.5.5.5", route: "/x" };
  l.check(req, 0);
  assert.strictEqual(l.check(req, 500).allowed, false);
  assert.deepStrictEqual(l.check(req, 1001), { allowed: true });
}

// 6. per-route window respected
{
  const l = new RateLimiter({ maxHits: 100, windowMs: 1000 });
  l.setRouteLimit("/s", { maxHits: 1, windowMs: 2000 });
  const req = { ip: "6.6.6.6", route: "/s" };
  l.check(req, 0);
  const denied = l.check(req, 1500);
  assert.strictEqual(denied.allowed, false);
  assert.strictEqual(denied.retryAfterMs, 500); // 0+2000-1500
}

console.log("rate-limiter: all tests passed");
