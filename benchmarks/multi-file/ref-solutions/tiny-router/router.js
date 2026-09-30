// REFERENCE SOLUTION — tiny-router
class Router {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }
  get(path, handler) {
    this.routes.push({ method: "GET", path, handler });
  }
  post(path, handler) {
    this.routes.push({ method: "POST", path, handler });
  }
  use(mw) {
    this.middlewares.push(mw);
  }
  handle(req) {
    const route = this.routes.find(
      (x) => x.method === req.method && x.path === req.path
    );
    const handler = route
      ? route.handler
      : () => ({ status: 404, body: "not found" });
    const dispatch = (i) => {
      if (i < this.middlewares.length) {
        let downstream;
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
          downstream = dispatch(i + 1);
          return downstream;
        };
        const out = this.middlewares[i](req, next);
        if (out !== undefined) return out; // short-circuit
        if (nextCalled) return downstream; // continued via next()
        return dispatch(i + 1); // auto-continue on bare undefined
      }
      return handler(req);
    };
    return dispatch(0);
  }
}

module.exports = { Router };
