// renderer.js — template renderer (starter code)
const { parse } = require("./parser");

// TODO: support {{#each item in list}} ... {{/each}} blocks.
//   - Look up `list` in the context (must be an array; non-array -> render nothing).
//   - For each element, render the block body with context extended by
//     { [item]: element } (item shadows outer context).
//   - Blocks may nest.
function render(template, context) {
  const tokens = parse(template);
  return renderTokens(tokens, context).out;
}

function renderTokens(tokens, context) {
  let out = "";
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === "text") {
      out += t.value;
      i++;
    } else if (t.type === "var") {
      const v = context[t.name];
      out += v === undefined || v === null ? "" : String(v);
      i++;
    } else if (t.type === "each") {
      // TODO: handle each block
      i++;
    } else {
      i++; // stray {{/each}}: skip
    }
  }
  return { out, next: i };
}

module.exports = { render };
