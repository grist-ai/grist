// product-service.js — inline validation (starter)
function createProduct(sku, price) {
  if (typeof sku !== "string" || !/^[A-Z]{2,4}-\d{3,6}$/.test(sku)) {
    throw new Error("invalid sku");
  }
  if (typeof price !== "number" || !(price > 0)) {
    throw new Error("invalid price");
  }
  return { sku, price };
}

module.exports = { createProduct };
