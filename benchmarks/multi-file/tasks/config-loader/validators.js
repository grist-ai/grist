// validators.js
function isPort(v) {
  return Number.isInteger(v) && v >= 1 && v <= 65535;
}
function isHost(v) {
  return typeof v === "string" && v.length > 0;
}
function isLogLevel(v) {
  return ["debug", "info", "warn", "error"].includes(v);
}
function isMaxRetries(v) {
  return Number.isInteger(v) && v >= 0 && v <= 10;
}

const VALIDATORS = {
  port: isPort,
  host: isHost,
  logLevel: isLogLevel,
  maxRetries: isMaxRetries,
};

module.exports = { VALIDATORS };
