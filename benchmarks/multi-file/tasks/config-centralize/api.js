// api.js — hardcoded constants (starter)
const PORT = 3000;
const RATE_LIMIT = 100;

function start() {
  return { port: PORT, rateLimit: RATE_LIMIT };
}

module.exports = { start };
