# Task: csv-parser

Write a JavaScript module `solution.js` in this directory that exports a function `parseCSV(text)`.

Rules:
- `text` is a CSV string. Returns an array of rows; each row is an array of strings.
- Fields are separated by commas. Rows are separated by `\n` (also handle `\r\n`).
- A field wrapped in double quotes may contain commas, newlines, and escaped quotes (`""` → `"`).
- A trailing newline at the end of input does not produce an extra empty row.
- Empty input (`""`) returns `[]`.

Use CommonJS (`module.exports`). Do not modify `test.js`.
