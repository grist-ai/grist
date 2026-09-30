// index.js — entry point
const { getTotal, getItems } = require("./consumer");

function summarize() {
  return { total: getTotal(), items: getItems() };
}

module.exports = { summarize };
