// producer.js — exports a named object
function fetchData() {
  return { items: [1, 2, 3], total: 3 };
}

module.exports = { fetchData };
