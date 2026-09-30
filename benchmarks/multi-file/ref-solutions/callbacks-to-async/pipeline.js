// REFERENCE pipeline.js
const { readData } = require("./reader");
const { processData } = require("./processor");
const { writeData } = require("./writer");

async function runPipeline(source, dest) {
  const raw = await readData(source);
  const processed = await processData(raw);
  return writeData(dest, processed);
}

module.exports = { runPipeline };
