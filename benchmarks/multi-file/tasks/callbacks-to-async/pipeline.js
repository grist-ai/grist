// pipeline.js — callback style (starter)
const { readData } = require("./reader");
const { processData } = require("./processor");
const { writeData } = require("./writer");

// TODO: convert to async/await. runPipeline(source, dest) must return a
// Promise that resolves to the writer's result string, and rejects with the
// underlying error (message preserved) on any failure.
function runPipeline(source, dest, callback) {
  readData(source, (err, raw) => {
    if (err) return callback(err);
    processData(raw, (err2, processed) => {
      if (err2) return callback(err2);
      writeData(dest, processed, callback);
    });
  });
}

module.exports = { runPipeline };
