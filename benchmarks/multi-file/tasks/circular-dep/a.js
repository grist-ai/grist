// a.js — BUG: circular dependency with b.js
const { helperB } = require("./b");

function helperA(x) {
  return `A(${x})`;
}

function combinedA(x) {
  return `${helperA(x)}+${helperB(x)}`;
}

module.exports = { helperA, combinedA };
