# Task: import-mismatch — fix the broken import

Something is wrong with how `consumer.js` imports from `producer.js`.
Running the test currently throws `TypeError: fetchData is not a function`.

1. Diagnose the mismatch: what does `producer.js` export vs. what
   `consumer.js` expects?
2. Fix it with the *smallest* change that makes the semantics correct.
   (Either side can change, but keep the fix minimal and consistent —
   don't restructure both files.)
3. `index.js` must keep working unchanged.

Do not modify `test.js`.
