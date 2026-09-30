# Task: template-engine — add `{{#each}}` loops

The parser already tokenizes `{{#each item in list}}` / `{{/each}}` blocks.
Implement rendering in `renderer.js`:

1. When hitting an `each` token, find the matching `endeach` (respect nesting).
2. Look up `list` in the context. If it's not an array, render nothing for
   the block.
3. For each element, render the block body with the context extended by
   `{ [item]: element }` — the loop variable shadows outer context.
4. Blocks may nest (an `each` inside an `each`).
5. Keep existing `text`/`var` behavior. A stray `{{/each}}` renders nothing.

Modify only `renderer.js`. Do not modify `test.js`, `parser.js`, or
`helpers.js`.
