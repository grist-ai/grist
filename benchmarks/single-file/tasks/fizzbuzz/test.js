const assert = require("node:assert");
const { fizzbuzz } = require("./solution.js");

assert.deepStrictEqual(fizzbuzz(0), []);
assert.deepStrictEqual(fizzbuzz(-3), []);
assert.deepStrictEqual(fizzbuzz(1), ["1"]);
assert.deepStrictEqual(fizzbuzz(3), ["1", "2", "Fizz"]);
assert.deepStrictEqual(fizzbuzz(5), ["1", "2", "Fizz", "4", "Buzz"]);
assert.deepStrictEqual(fizzbuzz(15)[14], "FizzBuzz");
assert.deepStrictEqual(fizzbuzz(15), [
  "1","2","Fizz","4","Buzz","Fizz","7","8","Fizz","Buzz",
  "11","Fizz","13","14","FizzBuzz",
]);
const big = fizzbuzz(100);
assert.strictEqual(big.length, 100);
assert.strictEqual(big[29], "FizzBuzz"); // 30
assert.strictEqual(big[98], "Fizz");     // 99
console.log("fizzbuzz: all tests passed");
