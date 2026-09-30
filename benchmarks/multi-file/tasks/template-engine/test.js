const assert = require("node:assert");
const { render } = require("./renderer");

// 1. basic each
assert.strictEqual(
  render("{{#each x in items}}[{{x}}]{{/each}}", { items: [1, 2, 3] }),
  "[1][2][3]"
);

// 2. var interpolation still works
assert.strictEqual(render("hi {{name}}!", { name: "ada" }), "hi ada!");

// 3. item shadows outer context
assert.strictEqual(
  render("{{x}}{{#each x in items}}{{x}}{{/each}}{{x}}", { x: "O", items: ["a", "b"] }),
  "OabO"
);

// 4. non-array list renders nothing
assert.strictEqual(
  render("a{{#each x in nope}}X{{/each}}b", {}),
  "ab"
);
assert.strictEqual(
  render("a{{#each x in nope}}X{{/each}}b", { nope: "str" }),
  "ab"
);

// 5. nested each
assert.strictEqual(
  render("{{#each r in rows}}{{#each c in r}}({{c}}){{/each}};{{/each}}", {
    rows: [[1, 2], [3]],
  }),
  "(1)(2);(3);"
);

// 6. empty array
assert.strictEqual(render("[{{#each x in xs}}X{{/each}}]", { xs: [] }), "[]");

// 7. object elements with property access via var
assert.strictEqual(
  render("{{#each u in users}}{{name}};{{/each}}", {
    users: [{ name: "a" }, { name: "b" }],
  }),
  // note: {{name}} looks up "name" in context, NOT u.name — loop var is the object
  ";;"
);

// 8. mixed text and vars inside loop
assert.strictEqual(
  render("List:{{#each n in nums}} {{n}}{{/each}}!", { nums: [1, 2] }),
  "List: 1 2!"
);

console.log("template-engine: all tests passed");
