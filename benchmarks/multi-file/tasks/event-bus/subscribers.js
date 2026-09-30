// subscribers.js — example subscribers (untouched by the task)
function auditLog(payload, topic) {
  return `[audit] ${topic}: ${JSON.stringify(payload)}`;
}

module.exports = { auditLog };
