// REFERENCE — template-engine/renderer.js
const { parse } = require("./parser");

function render(template, context) {
  const tokens = parse(template);
  return renderTokens(tokens, 0, context).out;
}

function renderTokens(tokens, start, context) {
  let out = "";
  let i = start;
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
      // find matching endeach respecting nesting
      let depth = 1;
      let j = i + 1;
      while (j < tokens.length && depth > 0) {
        if (tokens[j].type === "each") depth++;
        else if (tokens[j].type === "endeach") depth--;
        j++;
      }
      const body = tokens.slice(i + 1, j - 1);
      const list = context[t.list];
      if (Array.isArray(list)) {
        for (const el of list) {
          out += renderTokens(body, 0, { ...context, [t.item]: el }).out;
        }
      }
      i = j;
    } else {
      i++; // stray endeach
    }
  }
  return { out, next: i };
}

module.exports = { render };
