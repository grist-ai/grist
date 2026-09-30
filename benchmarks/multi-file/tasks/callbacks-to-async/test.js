const assert = require("node:assert");
const { readData } = require("./reader");
const { processData } = require("./processor");
const { writeData } = require("./writer");
const { runPipeline } = require("./pipeline");

async function main() {
  // individual functions return promises
  assert.strictEqual(await readData("s1"), "data-from-s1");
  await assert.rejects(() => readData(""), /no source/);
  await assert.rejects(() => readData(null), /no source/);

  assert.strictEqual(await processData("abc"), "ABC");
  await assert.rejects(() => processData(42), /bad input/);

  assert.strictEqual(await writeData("out.txt", "HELLO"), "written 5 chars to out.txt");
  await assert.rejects(() => writeData("", "x"), /no dest/);

  // pipeline composes them
  const res = await runPipeline("src", "dst");
  assert.strictEqual(res, "written 13 chars to dst"); // "DATA-FROM-SRC".length === 13

  // pipeline errors propagate with original messages
  await assert.rejects(() => runPipeline("", "dst"), /no source/);
  await assert.rejects(() => runPipeline("src", ""), /no dest/);

  // no callback params remain
  assert.strictEqual(readData.length, 1);
  assert.strictEqual(processData.length, 1);
  assert.strictEqual(writeData.length, 2);
  assert.strictEqual(runPipeline.length, 2);

  console.log("callbacks-to-async: all tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
