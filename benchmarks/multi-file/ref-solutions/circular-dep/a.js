const { helperA, helperB } = require("./helpers");

function combinedA(x) {
  return `${helperA(x)}+${helperB(x)}`;
}

module.exports = { helperA, combinedA };
