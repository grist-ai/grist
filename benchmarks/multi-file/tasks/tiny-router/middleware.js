// middleware.js — middleware helpers (starter code)
// A middleware is a function (req, next) => response|undefined.
// If it returns a value, the chain stops and that value is the response.
// If it returns undefined, next() continues the chain.
function logger(req, next) {
  // example middleware: just passes through
  return next();
}

module.exports = { logger };
