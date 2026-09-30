# Task: word-freq

Write a JavaScript module `solution.js` in this directory that exports a function `wordFreq(text)`.

Rules:
- `wordFreq(text)` returns a plain object mapping each word to its count.
- Words are maximal runs of alphanumeric characters (`[A-Za-z0-9]+`); everything else is a separator.
- Words are lowercased before counting.
- Return `{}` for empty input or input with no words.

Use CommonJS (`module.exports`). Do not modify `test.js`.
