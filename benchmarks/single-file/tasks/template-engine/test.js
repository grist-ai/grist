const assert = require("node:assert");
const { render } = require("./solution.js");

assert.strictEqual(render("Hello, {{name}}!", { name: "Ada" }), "Hello, Ada!");
assert.strictEqual(render("Hi {{missing}}!", {}), "Hi !");
assert.strictEqual(render("{{#if show}}yes{{/if}}", { show: 1 }), "yes");
assert.strictEqual(render("{{#if show}}yes{{/if}}", { show: 0 }), "");
assert.strictEqual(render("{{#if show}}yes{{/if}}", {}), "");
assert.strictEqual(
  render("{{#each items}}{{@index}}:{{this}};{{/each}}", { items: ["a", "b"] }),
  "0:a;1:b;"
);
assert.strictEqual(render("{{#each items}}x{{/each}}", {}), "");
assert.strictEqual(render("{{#each items}}x{{/each}}", { items: "nope" }), "");
assert.strictEqual(render("a {{name}} b {{#if ok}}OK{{/if}}", { name: "x", ok: true }), "a x b OK");
assert.strictEqual(render("keep {{foo bar}} as-is", {}), "keep {{foo bar}} as-is");
console.log("template-engine: all tests passed");
