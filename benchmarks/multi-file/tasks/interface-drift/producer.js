// producer.js — returns {status, payload}
function fetchUser(id) {
  if (id <= 0) return { status: "error", payload: null };
  return { status: "ok", payload: { id, name: "User" + id } };
}

module.exports = { fetchUser };
