const assert = require("node:assert");
const { parseCSV } = require("./solution.js");

assert.deepStrictEqual(parseCSV(""), []);
assert.deepStrictEqual(parseCSV("a,b,c"), [["a", "b", "c"]]);
assert.deepStrictEqual(parseCSV("a,b,c\n1,2,3\n"), [["a","b","c"],["1","2","3"]]);
assert.deepStrictEqual(parseCSV("a,b\r\n1,2\r\n"), [["a","b"],["1","2"]]);
assert.deepStrictEqual(parseCSV('"a,b",c'), [["a,b", "c"]]);
assert.deepStrictEqual(parseCSV('"a""b",c'), [['a"b', "c"]]);
assert.deepStrictEqual(parseCSV('"a\nb",c'), [["a\nb", "c"]]);
assert.deepStrictEqual(parseCSV('a,,"c"'), [["a", "", "c"]]);
assert.deepStrictEqual(
  parseCSV('name,note\n"Doe, John","says ""hi"""\n'),
  [["name","note"],["Doe, John",'says "hi"']]
);
console.log("csv-parser: all tests passed");
