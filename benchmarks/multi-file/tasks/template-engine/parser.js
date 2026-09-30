// parser.js — template parser (starter code)
// Splits a template into tokens:
//   {type:"text", value} | {type:"var", name} | {type:"each", item, list} | {type:"endeach"}
function parse(template) {
  const tokens = [];
  const re = /\{\{(#each\s+(\w+)\s+in\s+(\w+)|\/each|(\w+))\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) tokens.push({ type: "text", value: template.slice(last, m.index) });
    if (m[2] !== undefined) {
      tokens.push({ type: "each", item: m[2], list: m[3] });
    } else if (m[1] === "/each") {
      tokens.push({ type: "endeach" });
    } else {
      tokens.push({ type: "var", name: m[4] });
    }
    last = m.index + m[0].length;
  }
  if (last < template.length) tokens.push({ type: "text", value: template.slice(last) });
  return tokens;
}

module.exports = { parse };
