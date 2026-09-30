# Task: god-file-split — extract modules from a god file

`app.js` mixes three concerns. Split it into focused modules:

1. Create `db.js` exporting `UserStore` (the class, unchanged behavior).
2. Create `utils.js` exporting `formatUser` and `validateEmail` (unchanged).
3. Create `routes.js` exporting `createRoutes(store)` — it needs `formatUser`
   and `validateEmail`, so import them from `./utils`.
4. Rewrite `app.js` to import from the new modules and **re-export** the same
   four names (`UserStore`, `validateEmail`, `formatUser`, `createRoutes`) so
   existing `require("./app")` callers keep working.

Rules:
- No behavior changes — only moves + imports.
- Use CommonJS (`require` / `module.exports`) consistently.
- Do not modify `test.js`.

The test imports from all four files (`./app`, `./db`, `./utils`, `./routes`)
and checks both the new modules and the backward-compatible re-export.
