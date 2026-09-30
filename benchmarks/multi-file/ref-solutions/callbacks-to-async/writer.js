// REFERENCE writer.js
function writeData(dest, content) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (!dest) reject(new Error("no dest"));
      else resolve(`written ${content.length} chars to ${dest}`);
    }, 5);
  });
}

module.exports = { writeData };
