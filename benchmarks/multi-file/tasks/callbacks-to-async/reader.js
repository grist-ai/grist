// reader.js — callback style (starter)
function readData(source, callback) {
  // simulates async read
  setTimeout(() => {
    if (!source) callback(new Error("no source"));
    else callback(null, `data-from-${source}`);
  }, 5);
}

module.exports = { readData };
