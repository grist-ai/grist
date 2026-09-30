// index.js — entry point, uses all of the above
const { handleGetUser } = require("./handlers");
const { handleBatch } = require("./batch");

function main() {
  return {
    one: handleGetUser({ id: 1 }),
    many: handleBatch({ ids: [1, 2] }),
  };
}

module.exports = { main };
