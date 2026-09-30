// batch.js — uses getUsers (which internally uses fetchUser)
const { getUsers } = require("./api");

function handleBatch(req) {
  const users = getUsers(req.ids);
  return { status: 200, body: users };
}

module.exports = { handleBatch };
