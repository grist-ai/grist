// REFERENCE processor.js
function processData(raw) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (typeof raw !== "string") reject(new Error("bad input"));
      else resolve(raw.toUpperCase());
    }, 5);
  });
}

module.exports = { processData };
