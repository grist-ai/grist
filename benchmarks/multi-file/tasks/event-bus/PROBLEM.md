# Task: event-bus — add wildcard subscriptions

`bus.js` currently only delivers to exact-topic subscribers. Wire in the
`matchTopic` helper from `topics.js` so wildcard subscriptions work:

1. In `publish(topic, payload)`, deliver to every subscription whose topic
   pattern matches the published topic (use `matchTopic`).
2. `publish` returns the total number of handler invocations.
3. Each handler is called as `fn(payload, topic)` with the *published* topic.
4. Unsubscribing (the returned function) must keep working.

Modify only `bus.js`. Do not modify `test.js`, `topics.js`, or
`subscribers.js`.
