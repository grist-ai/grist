// REFERENCE app.js (re-export entry point)
const { UserStore } = require("./db");
const { validateEmail, formatUser } = require("./utils");
const { createRoutes } = require("./routes");

module.exports = { UserStore, validateEmail, formatUser, createRoutes };
