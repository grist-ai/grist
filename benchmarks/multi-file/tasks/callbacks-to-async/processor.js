// processor.js — callback style (starter)
function processData(raw, callback) {
  setTimeout(() => {
    if (typeof raw !== "string") callback(new Error("bad input"));
    else callback(null, raw.toUpperCase());
  }, 5);
}

module.exports = { processData };
