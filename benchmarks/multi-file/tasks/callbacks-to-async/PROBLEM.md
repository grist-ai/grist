# Task: callbacks-to-async — convert callback pipeline to async/await

The four modules use Node-style callbacks. Convert them all to promises:

1. `reader.js`: `readData(source)` returns a Promise resolving to the data
   string, rejecting with `Error("no source")` when source is falsy.
2. `processor.js`: `processData(raw)` returns a Promise resolving to the
   uppercased string, rejecting with `Error("bad input")` for non-strings.
3. `writer.js`: `writeData(dest, content)` returns a Promise resolving to the
   result string, rejecting with `Error("no dest")` when dest is falsy.
4. `pipeline.js`: `runPipeline(source, dest)` is `async`, awaits the three
   steps in order, and returns the writer's result. Errors propagate
   (reject) with their original messages.

Rules:
- No `callback` parameters anywhere after the conversion.
- Keep the same exported names (`readData`, `processData`, `writeData`,
  `runPipeline`).
- Keep the setTimeout-based async behavior (don't make them synchronous).
- Do not modify `test.js`.
