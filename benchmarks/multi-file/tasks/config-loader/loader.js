// loader.js — config loader (starter code)
const { DEFAULTS } = require("./defaults");
const { VALIDATORS } = require("./validators");

// Loads config: defaults <- fileConfig <- env overrides.
// TODO: implement env-var overrides:
//   - Read process.env.APP_PORT, APP_HOST, APP_LOG_LEVEL, APP_MAX_RETRIES.
//   - Map: APP_PORT->port, APP_HOST->host, APP_LOG_LEVEL->logLevel,
//     APP_MAX_RETRIES->maxRetries.
//   - Coerce numeric fields (port, maxRetries) from string to number.
//   - Validate each override with VALIDATORS; throw Error("invalid <key>: <value>")
//     on failure. Ignore unset env vars.
// Precedence: defaults < fileConfig < env.
function loadConfig(fileConfig = {}) {
  const cfg = { ...DEFAULTS, ...fileConfig };
  // TODO: apply env overrides here
  return cfg;
}

module.exports = { loadConfig };
