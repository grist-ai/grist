// b.js — BUG: circular dependency with a.js
const { helperA } = require("./a");

function helperB(x) {
  return `B(${x})`;
}

function combinedB(x) {
  return `${helperB(x)}+${helperA(x)}`;
}

module.exports = { helperB, combinedB };
