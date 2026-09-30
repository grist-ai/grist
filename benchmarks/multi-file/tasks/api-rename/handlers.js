// handlers.js — uses getUser
const { getUser } = require("./api");

function handleGetUser(req) {
  const user = getUser(req.id);
  return { status: 200, body: user };
}

module.exports = { handleGetUser };
