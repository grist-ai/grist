# Task: interface-drift — align producer/consumer interfaces

`producer.js` and `consumer.js` disagree on the result shape. The producer
returns `{ status: "ok"|"error", payload }`; the consumer reads
`{ ok, data }`. The test currently fails.

1. Decide which side is the contract. (Hint: the producer is the source of
   truth — it's also used elsewhere. Change the consumer.)
2. Update `consumer.js` so `getUserName` / `getUserId` work with the
   producer's actual shape: success is `status === "ok"`, the user object is
   in `payload`. On error (`status === "error"`), throw `Error("fetch failed")`.
3. Keep `index.js` unchanged.

Do not modify `test.js`.
