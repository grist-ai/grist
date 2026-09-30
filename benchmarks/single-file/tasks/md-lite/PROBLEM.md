# Task: md-lite

Write a JavaScript module `solution.js` in this directory that exports a function `mdLite(md)`.

Rules — convert a small Markdown subset to HTML:
- `# `, `## `, `### ` at line start → `<h1>`, `<h2>`, `<h3>` (inline formatting applies inside).
- Lines starting with `- ` form a `<ul>`; each becomes `<li>...</li>`. Consecutive `- ` lines share one `<ul>`.
- Other non-empty lines → `<p>...</p>`. Empty lines separate blocks (produce no output).
- Inline: `**bold**` → `<strong>`, `*italic*` → `<em>`, `` `code` `` → `<code>`, `[text](url)` → `<a href="url">text</a>`.
- Inline nesting (e.g. bold inside italic) is NOT required.
- No HTML escaping is required.

Each block element is emitted on its own line; the result ends with a single trailing newline.

Use CommonJS (`module.exports`). Do not modify `test.js`.
