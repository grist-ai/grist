# Task: tiny-router — add middleware chaining

The router in `router.js` currently runs the matched handler directly. Add
Express-style middleware support:

1. Add a `use(mw)` method to `Router` that registers a middleware function.
   Middlewares run in registration order, before the route handler.
2. Each middleware has signature `(req, next) => response | undefined`.
   - If it returns a value (not `undefined`), the chain stops and that value
     becomes the response.
   - If it returns `undefined`, call `next()` to continue to the next
     middleware (or the route handler when middlewares are exhausted).
3. `handle(req)` must run: all middlewares in order, then the matched route
   handler. If no route matches, return `{ status: 404, body: "not found" }`
   (middlewares still run first).

Do not change the existing `get`/`post` API. You may modify `router.js`
(and only `router.js` — the fix belongs there). Do not modify `test.js`.
