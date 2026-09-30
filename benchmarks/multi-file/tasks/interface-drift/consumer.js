// consumer.js — BUG: expects {ok, data}, but producer returns {status, payload}
const { fetchUser } = require("./producer");

function getUserName(id) {
  const res = fetchUser(id);
  if (!res.ok) throw new Error("fetch failed");
  return res.data.name;
}

function getUserId(id) {
  const res = fetchUser(id);
  return res.data.id;
}

module.exports = { getUserName, getUserId };
