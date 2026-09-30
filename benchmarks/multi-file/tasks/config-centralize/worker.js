// worker.js — hardcoded constants (starter)
const CONCURRENCY = 4;
const RETRY_MS = 1000;

function spawn() {
  return { concurrency: CONCURRENCY, retryMs: RETRY_MS };
}

module.exports = { spawn };
