const assert = require("node:assert");
const { isPalindrome } = require("./solution.js");

assert.strictEqual(isPalindrome("racecar"), true);
assert.strictEqual(isPalindrome("RaceCar"), true);
assert.strictEqual(isPalindrome("A man, a plan, a canal: Panama"), true);
assert.strictEqual(isPalindrome("hello"), false);
assert.strictEqual(isPalindrome(""), true);
assert.strictEqual(isPalindrome("!!!"), true);
assert.strictEqual(isPalindrome("ab"), false);
assert.strictEqual(isPalindrome("aba"), true);
assert.strictEqual(isPalindrome("No 'x' in Nixon"), true);
console.log("palindrome: all tests passed");
