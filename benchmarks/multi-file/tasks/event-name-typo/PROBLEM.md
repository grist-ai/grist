# Task: event-name-typo — fix the mismatched event name

The emitter fires `"user-created"` (kebab-case) but the listener subscribes
to `"user_created"` (snake_case), so user events are silently dropped. The
`order_shipped` event works fine (both sides use snake_case).

1. Find the mismatch and fix it. Change the *listener* to match the emitter
   (`"user-created"`) — the emitter's naming is the established convention
   for user events.
2. After the fix, `scenario()` must return both events.

Do not modify `test.js`, `emitter.js`, or `index.js`. Only `listener.js`.
