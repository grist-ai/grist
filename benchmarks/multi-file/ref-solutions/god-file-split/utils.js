// REFERENCE utils.js
function validateEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatUser(user) {
  return `#${user.id} ${user.name} <${user.email}>`;
}

module.exports = { validateEmail, formatUser };
