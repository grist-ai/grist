const assert = require("node:assert");
const { retry } = require("./solution.js");

async function main() {
  // succeeds first try
  let calls = 0;
  const v = await retry(async () => { calls++; return "ok"; }, { maxAttempts: 3, baseDelayMs: 10 });
  assert.strictEqual(v, "ok");
  assert.strictEqual(calls, 1);

  // fails twice then succeeds; attempt index passed through
  calls = 0;
  const seen = [];
  const v2 = await retry(async (a) => { seen.push(a); calls++; if (calls < 3) throw new Error("x"); return 42; },
    { maxAttempts: 5, baseDelayMs: 5 });
  assert.strictEqual(v2, 42);
  assert.deepStrictEqual(seen, [0, 1, 2]);

  // all attempts fail -> throws last error, exact attempt count
  calls = 0;
  await assert.rejects(
    retry(async () => { calls++; throw new Error("boom-" + calls); }, { maxAttempts: 3, baseDelayMs: 5 }),
    /boom-3/
  );
  assert.strictEqual(calls, 3);

  // maxAttempts=1: single try, no waiting (should finish fast)
  const t0 = Date.now();
  await assert.rejects(retry(async () => { throw new Error("nope"); }, { maxAttempts: 1, baseDelayMs: 5000 }));
  assert.ok(Date.now() - t0 < 1000, "should not wait with maxAttempts=1");

  // backoff timing: delays grow geometrically (allow slop)
  const stamps = [];
  await assert.rejects(retry(async () => { stamps.push(Date.now()); throw new Error("t"); },
    { maxAttempts: 3, baseDelayMs: 50, factor: 2 }));
  const d1 = stamps[1] - stamps[0], d2 = stamps[2] - stamps[1];
  assert.ok(d1 >= 40 && d1 < 500, `d1=${d1}`);
  assert.ok(d2 >= 90 && d2 < 900, `d2=${d2}`);
  assert.ok(d2 > d1, "backoff should grow");

  console.log("retry-backoff: all tests passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
