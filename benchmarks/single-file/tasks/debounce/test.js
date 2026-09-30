const assert = require("node:assert");
const { debounce } = require("./solution.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let calls = [];
  const d = debounce((...a) => { calls.push(a); return a[0] * 2; }, 30);
  d(1); d(2); d(3);
  assert.deepStrictEqual(calls, []); // not sync
  await sleep(60);
  assert.deepStrictEqual(calls, [[3]]); // trailing edge, latest args

  // cancel
  calls = [];
  const d2 = debounce((v) => calls.push(v), 30);
  d2("x");
  d2.cancel();
  await sleep(60);
  assert.deepStrictEqual(calls, []);

  // flush
  calls = [];
  const d3 = debounce((v) => { calls.push(v); return v + "!"; }, 50);
  d3("a");
  const ret = d3.flush();
  assert.strictEqual(ret, "a!");
  assert.deepStrictEqual(calls, ["a"]);
  await sleep(80);
  assert.deepStrictEqual(calls, ["a"]); // no double-fire
  assert.strictEqual(d3.flush(), undefined); // nothing pending

  // this-binding
  const obj = { v: 42, get() { return this.v; } };
  let got;
  const d4 = debounce(function () { got = this.v; }, 20);
  d4.call(obj);
  await sleep(50);
  assert.strictEqual(got, 42);

  console.log("debounce: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
