// listener.js — BUG: subscribes to "user-created" but emitter fires "user-created"
const { bus } = require("./emitter");

const received = [];

bus.on("user-created", (user) => {
  received.push({ type: "user", user });
});
bus.on("order_shipped", (order) => {
  received.push({ type: "order", order });
});

function getReceived() {
  return received;
}
function clearReceived() {
  received.length = 0;
}

module.exports = { getReceived, clearReceived };
