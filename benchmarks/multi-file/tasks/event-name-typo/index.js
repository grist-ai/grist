// index.js
require("./listener");
const { userCreated, orderShipped } = require("./emitter");
const { getReceived, clearReceived } = require("./listener");

function scenario() {
  clearReceived();
  userCreated({ id: 1, name: "Ada" });
  orderShipped({ id: 99 });
  return getReceived();
}

module.exports = { scenario };
