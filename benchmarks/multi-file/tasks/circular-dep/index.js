// index.js
const { combinedA } = require("./a");
const { combinedB } = require("./b");

function run(x) {
  return [combinedA(x), combinedB(x)];
}

module.exports = { run };
