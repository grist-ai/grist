# Task: event-emitter

Write a JavaScript module `solution.js` in this directory that exports a class `EventEmitter`.

Rules:
- `on(event, listener)` — registers `listener` for `event`. Returns `this` (chainable).
- `off(event, listener)` — removes that exact `listener` for `event`. Returns `this`.
- `once(event, listener)` — registers a one-time listener. Returns `this`.
- `emit(event, ...args)` — calls all listeners for `event` with `args`, in registration order. Returns the number of listeners that were called.
- Emitting an event with no listeners returns `0` and does not throw.
- A `once` listener is removed after its first call, even if it was registered multiple times (each registration fires once).

Use CommonJS (`module.exports`). Do not modify `test.js`.
