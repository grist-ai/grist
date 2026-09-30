# Task: ini-parser

Write a JavaScript module `solution.js` in this directory that exports a function `parseIni(text)`.

Rules:
- Parses INI text into `{ sections: { [name]: { [key]: value } }, get(section, key) }`.
- `[section]` headers start a section; keys before any header go in a section named `""`.
- `key = value` pairs: trim whitespace around key and value.
- Blank lines ignored. Lines starting with `#` or `;` are comments (only when first non-whitespace char).
- Inline comments are NOT stripped (`key = a # b` → value `"a # b"`).
- A duplicate section header throws an `Error` containing "duplicate".
- `get(section, key)` returns the value or `undefined`.

Use CommonJS (`module.exports`). Do not modify `test.js`.
