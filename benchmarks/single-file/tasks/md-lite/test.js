const assert = require("node:assert");
const { mdLite } = require("./solution.js");

assert.strictEqual(mdLite("# Title"), "<h1>Title</h1>\n");
assert.strictEqual(mdLite("## Sub"), "<h2>Sub</h2>\n");
assert.strictEqual(
  mdLite("Hello **bold** and *italic*"),
  "<p>Hello <strong>bold</strong> and <em>italic</em></p>\n"
);
assert.strictEqual(
  mdLite("Use `x` and [link](http://e.com)"),
  '<p>Use <code>x</code> and <a href="http://e.com">link</a></p>\n'
);
assert.strictEqual(
  mdLite("- a\n- b"),
  "<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n"
);
assert.strictEqual(
  mdLite("para one\n\npara two"),
  "<p>para one</p>\n<p>para two</p>\n"
);
assert.strictEqual(
  mdLite("# H **b**\n\n- **x**\n- y"),
  "<h1>H <strong>b</strong></h1>\n<ul>\n<li><strong>x</strong></li>\n<li>y</li>\n</ul>\n"
);
assert.strictEqual(mdLite(""), "");
console.log("md-lite: all tests passed");
