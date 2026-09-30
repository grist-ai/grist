// helpers.js — context helpers (untouched)
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

module.exports = { pick };
