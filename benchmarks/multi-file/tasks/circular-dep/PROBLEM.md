# Task: circular-dep — break the circular dependency

`a.js` and `b.js` require each other. In Node this means one of them sees a
partially-initialized module, and the test currently throws
`TypeError: helperA is not a function` (or similar).

1. Break the cycle. The cleanest approach: extract the leaf helpers
   (`helperA`, `helperB` — which don't depend on each other) into a new
   `helpers.js`, and have `a.js` / `b.js` import from there instead of from
   each other.
2. Keep all four exported names working: `a.js` exports `helperA, combinedA`;
   `b.js` exports `helperB, combinedB`; `helpers.js` exports
   `helperA, helperB`.
3. `combinedA(x)` must return `"A(x)+B(x)"`, `combinedB(x)` → `"B(x)+A(x)"`.

You may create `helpers.js` and modify `a.js` / `b.js`. Do not modify
`test.js` or `index.js`.
