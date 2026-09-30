# Task: csv-stringify

Write a JavaScript module `solution.js` in this directory that exports a function `stringify(rows, opts)`.

Rules:
- `rows` is an array of arrays (each inner array = one row). `opts.header` (optional array) is emitted as the first row.
- Cells containing `,`, `"`, `\n`, or `\r` are wrapped in double quotes, with inner `"` doubled. Other cells are emitted bare.
- `null`/`undefined` cells become empty strings. Other values are `String()`-ified.
- Rows are joined with `\n`; the output ends with a single trailing `\n` (empty input → `""`).
- `opts.delimiter` (default `,`) replaces the field separator (quoting rules still apply to the delimiter).

Use CommonJS (`module.exports`). Do not modify `test.js`.
