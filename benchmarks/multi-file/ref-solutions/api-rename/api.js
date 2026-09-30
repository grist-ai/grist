// api.js — the API module (has the old name)
function getUser(id) {
  return { id, name: "User" + id };
}
function getUsers(ids) {
  return ids.map(getUser);
}

module.exports = { getUser, getUsers };
