# Task: markdown-toc

Write a JavaScript module `solution.js` in this directory that exports a function `toc(markdown)`.

Rules:
- `markdown` is a string. Return an array of `{ level, text, slug }` for each ATX heading (`#` to `######`).
- `level` is the heading level (1–6).
- `text` is the heading text with leading/trailing whitespace trimmed. Strip inline markdown formatting: remove `**`, `__`, `*`, `` ` ``, `~~`, and link syntax `[label](url)` → `label`.
- `slug`: lowercase, spaces → `-`, remove all chars except `a-z`, `0-9`, `-`. Collapse consecutive `-` into one; trim leading/trailing `-`.
- Ignore headings inside fenced code blocks (``` ... ```).
- Lines with 7+ `#` are not headings. A `#` must be followed by a space (or end of line) to count.
- Setext headings (`===`/`---` underlines) are NOT required — ignore them.

Use CommonJS (`module.exports`). Do not modify `test.js`.
