// REFERENCE routes.js
const { formatUser, validateEmail } = require("./utils");

function createRoutes(store) {
  return {
    getUser: (id) => {
      const user = store.get(id);
      if (!user) return { status: 404, body: "not found" };
      return { status: 200, body: formatUser(user) };
    },
    createUser: (name, email) => {
      if (!validateEmail(email)) return { status: 400, body: "bad email" };
      const user = store.add(name, email);
      return { status: 201, body: formatUser(user) };
    },
  };
}

module.exports = { createRoutes };
