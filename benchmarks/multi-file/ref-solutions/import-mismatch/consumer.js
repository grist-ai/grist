// consumer.js — BUG: imports the module object, calls it as a function
const { fetchData } = require("./producer");

function getTotal() {
  const result = fetchData();
  return result.total;
}

function getItems() {
  const result = fetchData();
  return result.items;
}

module.exports = { getTotal, getItems };
