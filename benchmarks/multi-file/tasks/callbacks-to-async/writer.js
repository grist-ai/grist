// writer.js — callback style (starter)
function writeData(dest, content, callback) {
  setTimeout(() => {
    if (!dest) callback(new Error("no dest"));
    else callback(null, `written ${content.length} chars to ${dest}`);
  }, 5);
}

module.exports = { writeData };
