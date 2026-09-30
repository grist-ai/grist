// REFERENCE db.js
class UserStore {
  constructor() {
    this.users = new Map();
    this.nextId = 1;
  }
  add(name, email) {
    const id = this.nextId++;
    const user = { id, name, email };
    this.users.set(id, user);
    return user;
  }
  get(id) {
    return this.users.get(id) || null;
  }
  all() {
    return [...this.users.values()];
  }
}

module.exports = { UserStore };
