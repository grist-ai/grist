const { helperA, helperB } = require("./helpers");

function combinedB(x) {
  return `${helperB(x)}+${helperA(x)}`;
}

module.exports = { helperB, combinedB };
