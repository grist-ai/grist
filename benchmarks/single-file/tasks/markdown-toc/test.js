const assert = require("node:assert");
const { toc } = require("./solution.js");

assert.deepStrictEqual(toc(""), []);
assert.deepStrictEqual(toc("# Hello World"), [
  { level: 1, text: "Hello World", slug: "hello-world" },
]);
assert.deepStrictEqual(toc("##  Deep   Dive  "), [
  { level: 2, text: "Deep   Dive", slug: "deep-dive" },
]);
assert.deepStrictEqual(
  toc("# A\ntext\n### B\n####### not heading\n#NoSpace"),
  [
    { level: 1, text: "A", slug: "a" },
    { level: 3, text: "B", slug: "b" },
  ]
);
assert.deepStrictEqual(toc("## **Bold** and `code`"), [
  { level: 2, text: "Bold and code", slug: "bold-and-code" },
]);
assert.deepStrictEqual(toc("# See [docs](https://x.io/a) now"), [
  { level: 1, text: "See docs now", slug: "see-docs-now" },
]);
assert.deepStrictEqual(toc("# C++ & Go!"), [
  { level: 1, text: "C++ & Go!", slug: "c-go" },
]);
const fenced = "# Real\n```\n# Fake\n```\n## Real2";
assert.deepStrictEqual(toc(fenced), [
  { level: 1, text: "Real", slug: "real" },
  { level: 2, text: "Real2", slug: "real2" },
]);
console.log("markdown-toc: all tests passed");
