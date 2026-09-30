const assert = require("node:assert");
const { promisePool } = require("./solution.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // order of results matches task order, not completion order
  const res = await promisePool([
    () => sleep(30).then(() => "a"),
    () => sleep(10).then(() => "b"),
    () => sleep(20).then(() => "c"),
  ], 2);
  assert.deepStrictEqual(res, ["a", "b", "c"]);

  // concurrency limit respected
  let running = 0, maxRunning = 0;
  const mk = (ms) => () => { running++; maxRunning = Math.max(maxRunning, running); return sleep(ms).then(() => { running--; return ms; }); };
  await promisePool([mk(20), mk(20), mk(20), mk(20)], 2);
  assert.ok(maxRunning <= 2, `maxRunning=${maxRunning}`);
  assert.strictEqual(running, 0);

  // n larger than task count
  assert.deepStrictEqual(await promisePool([() => Promise.resolve(1)], 10), [1]);

  // rejection propagates
  await assert.rejects(
    promisePool([() => Promise.resolve(1), () => Promise.reject(new Error("boom"))], 2),
    /boom/
  );

  // empty task list
  assert.deepStrictEqual(await promisePool([], 3), []);

  console.log("promise-pool: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
