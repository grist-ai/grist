# Task: extract-validators — centralize inline validation

The three service files each inline their own validation logic. Extract it:

1. Create `validators.js` exporting:
   - `isNonEmptyString(v)` — string with `trim().length > 0`
   - `isEmail(v)` — matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
   - `isPositiveInt(v)` — integer `> 0`
   - `isPositiveNumber(v)` — number `> 0` (reject NaN)
   - `isSku(v)` — matches `/^[A-Z]{2,4}-\d{3,6}$/`
2. Rewrite the three services to `require("./validators")` and use these
   functions. Keep the exact same error messages (`"invalid name"`,
   `"invalid email"`, `"invalid userId"`, `"invalid amount"`,
   `"invalid sku"`, `"invalid price"`).
3. No behavior change — pure extraction.

Do not modify `test.js`.
