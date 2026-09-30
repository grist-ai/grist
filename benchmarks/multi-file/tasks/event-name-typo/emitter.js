// emitter.js
const { EventEmitter } = require("node:events");

const bus = new EventEmitter();

function userCreated(user) {
  bus.emit("user-created", user);
}

function orderShipped(order) {
  bus.emit("order_shipped", order);
}

module.exports = { bus, userCreated, orderShipped };
