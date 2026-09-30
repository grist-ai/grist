const { fetchUser } = require("./producer");

function getUserName(id) {
  const res = fetchUser(id);
  if (res.status !== "ok") throw new Error("fetch failed");
  return res.payload.name;
}

function getUserId(id) {
  const res = fetchUser(id);
  if (res.status !== "ok") throw new Error("fetch failed");
  return res.payload.id;
}

module.exports = { getUserName, getUserId };
