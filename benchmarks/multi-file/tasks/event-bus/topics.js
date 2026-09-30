// topics.js — topic matching helpers
// Topics are dot-separated, e.g. "user.created", "order.shipped.eu".
// A subscription topic may contain "*" segments matching exactly one level:
//   "user.*" matches "user.created" but NOT "user.created.extra".
// A trailing "#" matches the prefix plus any depth (including the prefix itself):
//   "user.#" matches "user", "user.created", "user.created.extra".
function matchTopic(subscription, topic) {
  const sp = subscription.split(".");
  const tp = topic.split(".");
  for (let i = 0; i < sp.length; i++) {
    if (sp[i] === "#") return true; // "#" must be last; matches rest
    if (i >= tp.length) return false;
    if (sp[i] === "*") continue;
    if (sp[i] !== tp[i]) return false;
  }
  return sp.length === tp.length;
}

module.exports = { matchTopic };
