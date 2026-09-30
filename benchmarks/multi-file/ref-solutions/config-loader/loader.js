// REFERENCE — config-loader/loader.js
const { DEFAULTS } = require("./defaults");
const { VALIDATORS } = require("./validators");

const ENV_MAP = {
  APP_PORT: "port",
  APP_HOST: "host",
  APP_LOG_LEVEL: "logLevel",
  APP_MAX_RETRIES: "maxRetries",
};
const NUMERIC = new Set(["port", "maxRetries"]);

function loadConfig(fileConfig = {}) {
  const cfg = { ...DEFAULTS, ...fileConfig };
  for (const [envKey, key] of Object.entries(ENV_MAP)) {
    let raw = process.env[envKey];
    if (raw === undefined || raw === "") continue;
    let value = raw;
    if (NUMERIC.has(key)) value = Number(raw);
    const validate = VALIDATORS[key];
    if (!validate(value)) {
      throw new Error(`invalid ${key}: ${raw}`);
    }
    cfg[key] = value;
  }
  return cfg;
}

module.exports = { loadConfig };
