const assert = require("node:assert");
const { parseIni } = require("./solution.js");

const cfg = parseIni(`
# a comment
; another comment
top = 1

[server]
host = example.com
port = 8080

[db]
url = postgres://a # b
`);
assert.strictEqual(cfg.get("", "top"), "1");
assert.strictEqual(cfg.get("server", "host"), "example.com");
assert.strictEqual(cfg.get("server", "port"), "8080");
assert.strictEqual(cfg.get("db", "url"), "postgres://a # b");
assert.strictEqual(cfg.get("server", "missing"), undefined);
assert.strictEqual(cfg.get("nope", "x"), undefined);
assert.deepStrictEqual(cfg.sections.server, { host: "example.com", port: "8080" });

assert.throws(() => parseIni("[a]\n[a]\n"), /duplicate/);

// whitespace trimming
const c2 = parseIni("[s]\n  k   =   v  \n");
assert.strictEqual(c2.get("s", "k"), "v");
console.log("ini-parser: all tests passed");
