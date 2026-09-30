# Task: schema-validate

Write a JavaScript module `solution.js` in this directory that exports a builder object `s` with:

Rules:
- `s.string()`, `s.number()`, `s.boolean()` — primitive validators.
- `s.object({ key: validator, ... })` — all listed keys required (unless optional).
- `s.array(itemValidator)` — every element must validate.
- `.optional()` on any validator — allows `undefined` (skips validation when undefined).
- Each validator has `.validate(v)` returning `{ ok: true }` or `{ ok: false, errors: [...] }` where `errors` is a non-empty array of human-readable strings.
- `s.object().validate` reports which key failed (error strings mention the key name).

Use CommonJS (`module.exports`). Do not modify `test.js`.
