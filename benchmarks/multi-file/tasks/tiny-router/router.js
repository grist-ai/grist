// router.js — tiny Express-like router (starter code)
class Router {
  constructor() {
    this.routes = []; // {method, path, handler}
  }
  get(path, handler) {
    this.routes.push({ method: "GET", path, handler });
  }
  post(path, handler) {
    this.routes.push({ method: "POST", path, handler });
  }
  // TODO: add use(middleware) and next() chaining
  handle(req) {
    const r = this.routes.find(
      (x) => x.method === req.method && x.path === req.path
    );
    if (!r) return { status: 404, body: "not found" };
    return r.handler(req);
  }
}

module.exports = { Router };
