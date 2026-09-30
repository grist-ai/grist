# Task: expr-eval

Write a JavaScript module `solution.js` in this directory that exports a function `evaluate(expr)`.

Rules:
- Evaluates an arithmetic expression string and returns the number result.
- Operators: `+ - * / ^` with precedence `^` > unary `-` > `* /` > `+ -`. `^` is right-associative; the rest left-associative.
- Parentheses for grouping. Whitespace is ignored. Numbers are non-negative decimals (e.g. `3`, `3.5`).
- Unary minus before a number or parenthesized group (e.g. `-3`, `-(2+1)`, `--3`).
- Division by zero yields `Infinity`/`-Infinity` per JS semantics (not an error).
- Throw an `Error` on invalid input (empty string, bad characters, unbalanced parens, dangling operator).

Use CommonJS (`module.exports`). Do not modify `test.js`.
