// index.js
const { getUserName, getUserId } = require("./consumer");

function describe(id) {
  return `${getUserName(id)} (#${getUserId(id)})`;
}

module.exports = { describe };
