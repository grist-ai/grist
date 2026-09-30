// order-service.js — inline validation (starter)
function createOrder(userId, amount) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("invalid userId");
  }
  if (typeof amount !== "number" || !(amount > 0)) {
    throw new Error("invalid amount");
  }
  return { userId, amount };
}

module.exports = { createOrder };
