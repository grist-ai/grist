const { isPositiveInt, isPositiveNumber } = require("./validators");
function createOrder(userId, amount) {
  if (!isPositiveInt(userId)) throw new Error("invalid userId");
  if (!isPositiveNumber(amount)) throw new Error("invalid amount");
  return { userId, amount };
}
module.exports = { createOrder };
