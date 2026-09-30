// middleware.js — express-style wrapper (untouched)
function rateLimitMiddleware(limiter) {
  return (req, next) => {
    const res = limiter.check(req);
    if (!res.allowed) return { status: 429, body: "slow down", retryAfterMs: res.retryAfterMs };
    return next();
  };
}

module.exports = { rateLimitMiddleware };
