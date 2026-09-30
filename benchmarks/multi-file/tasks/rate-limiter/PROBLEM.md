# Task: rate-limiter — add per-route limits

`RateLimiter` currently applies one global limit keyed by IP. Add per-route
limits:

1. Add `setRouteLimit(route, { maxHits, windowMs })` storing the override.
2. `check(req, now)` uses the route-specific limit when `req.route` has one
   registered, else the constructor default.
3. The hit key must incorporate the route: hits for `/a` don't count against
   `/b`. (Key format is up to you, but routes must be isolated.)
4. On denial return `{ allowed: false, retryAfterMs }` where `retryAfterMs`
   is the ms until the oldest hit *in the applicable window* expires
   (i.e. `oldestTimestamp + windowMs - now`, clamped to >= 0).
5. Keep the default-limit behavior working when no route limit is set.

Modify only `limiter.js`. Do not modify `test.js`, `store.js`, or
`middleware.js`.
