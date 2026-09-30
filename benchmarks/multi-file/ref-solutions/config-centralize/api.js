const { CONFIG } = require("./config");
function start() {
  return { port: CONFIG.api.port, rateLimit: CONFIG.api.rateLimit };
}
module.exports = { start };
