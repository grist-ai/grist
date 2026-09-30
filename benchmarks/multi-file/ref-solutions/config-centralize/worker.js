const { CONFIG } = require("./config");
function spawn() {
  return { concurrency: CONFIG.worker.concurrency, retryMs: CONFIG.worker.retryMs };
}
module.exports = { spawn };
