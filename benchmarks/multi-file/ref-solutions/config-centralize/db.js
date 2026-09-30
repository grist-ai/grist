const { CONFIG } = require("./config");
function connect() {
  return { maxConnections: CONFIG.db.maxConnections, timeoutMs: CONFIG.db.timeoutMs };
}
module.exports = { connect };
