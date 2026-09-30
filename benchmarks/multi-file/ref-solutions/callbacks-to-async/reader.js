// REFERENCE reader.js
function readData(source) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (!source) reject(new Error("no source"));
      else resolve(`data-from-${source}`);
    }, 5);
  });
}

module.exports = { readData };
