// REFERENCE validators.js
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function isEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}
function isPositiveNumber(v) {
  return typeof v === "number" && v > 0;
}
function isSku(v) {
  return typeof v === "string" && /^[A-Z]{2,4}-\d{3,6}$/.test(v);
}

module.exports = { isNonEmptyString, isEmail, isPositiveInt, isPositiveNumber, isSku };
