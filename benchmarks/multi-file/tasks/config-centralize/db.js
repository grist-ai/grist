// db.js — hardcoded constants (starter)
const MAX_CONNECTIONS = 10;
const TIMEOUT_MS = 5000;

function connect() {
  return { maxConnections: MAX_CONNECTIONS, timeoutMs: TIMEOUT_MS };
}

module.exports = { connect };
