# Task: api-rename — rename `getUser` to `fetchUser` across files

The function `getUser` in `api.js` is being renamed to `fetchUser`.
Update all call sites consistently:

1. In `api.js`: rename the function definition and its export. Note
   `getUsers` calls it internally — update that call too.
2. In `handlers.js`: update the import and the call.
3. `batch.js` and `index.js` don't reference `getUser` directly — verify they
   still work (they use `getUsers` / the handlers).
4. The old name `getUser` must not appear anywhere in the codebase after the
   rename (except in PROBLEM.md / test.js which you must not modify).

Do not modify `test.js`. Behavior must be unchanged — pure rename.
