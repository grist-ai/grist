// server.js — wires router + middleware (starter code)
const { Router } = require("./router");

function createServer() {
  const router = new Router();
  router.get("/hello", (req) => ({ status: 200, body: "hi" }));
  return router;
}

module.exports = { createServer };
