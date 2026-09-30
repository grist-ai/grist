const { isSku, isPositiveNumber } = require("./validators");
function createProduct(sku, price) {
  if (!isSku(sku)) throw new Error("invalid sku");
  if (!isPositiveNumber(price)) throw new Error("invalid price");
  return { sku, price };
}
module.exports = { createProduct };
