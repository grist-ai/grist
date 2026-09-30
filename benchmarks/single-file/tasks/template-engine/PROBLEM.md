# Task: template-engine

Write a JavaScript module `solution.js` in this directory that exports a function `render(tpl, ctx)`.

Rules:
- `{{name}}` — interpolates `ctx.name` (missing → `""`).
- `{{#if cond}}...{{/if}}` — includes the block if `ctx.cond` is truthy.
- `{{#each list}}...{{/each}}` — repeats the block for each item of `ctx.list` (must be an array; missing/non-array → renders nothing). Inside the block, `{{this}}` is the item and `{{@index}}` is the index.
- Dotted paths are NOT required — only top-level names, `this`, and `@index`.
- No nesting of `#if`/`#each` blocks inside each other is required (tests don't nest).
- Unknown tags (e.g. `{{foo bar}}`) are left as-is.

Use CommonJS (`module.exports`). Do not modify `test.js`.
