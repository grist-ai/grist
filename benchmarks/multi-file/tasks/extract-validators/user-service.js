// user-service.js — inline validation (starter)
function createUser(name, email) {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("invalid name");
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("invalid email");
  }
  return { name: name.trim(), email };
}

module.exports = { createUser };
