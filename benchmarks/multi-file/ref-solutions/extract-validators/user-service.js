const { isNonEmptyString, isEmail } = require("./validators");
function createUser(name, email) {
  if (!isNonEmptyString(name)) throw new Error("invalid name");
  if (!isEmail(email)) throw new Error("invalid email");
  return { name: name.trim(), email };
}
module.exports = { createUser };
