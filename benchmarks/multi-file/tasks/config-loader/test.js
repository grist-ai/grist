const assert = require("node:assert");
const { loadConfig } = require("./loader");

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const CLEAR = {
  APP_PORT: undefined,
  APP_HOST: undefined,
  APP_LOG_LEVEL: undefined,
  APP_MAX_RETRIES: undefined,
};

// 1. defaults when nothing set
{
  const cfg = withEnv(CLEAR, () => loadConfig());
  assert.deepStrictEqual(cfg, {
    port: 3000,
    host: "localhost",
    logLevel: "info",
    maxRetries: 3,
  });
}

// 2. file config overrides defaults
{
  const cfg = withEnv(CLEAR, () => loadConfig({ port: 8080 }));
  assert.strictEqual(cfg.port, 8080);
  assert.strictEqual(cfg.host, "localhost");
}

// 3. env overrides file and defaults, with coercion
{
  const cfg = withEnv(
    { ...CLEAR, APP_PORT: "9000", APP_LOG_LEVEL: "debug" },
    () => loadConfig({ port: 8080, logLevel: "warn" })
  );
  assert.strictEqual(cfg.port, 9000);
  assert.strictEqual(typeof cfg.port, "number");
  assert.strictEqual(cfg.logLevel, "debug");
  assert.strictEqual(cfg.host, "localhost");
}

// 4. invalid env value throws
{
  assert.throws(
    () => withEnv({ ...CLEAR, APP_PORT: "99999" }, () => loadConfig()),
    /invalid port: 99999/
  );
  assert.throws(
    () => withEnv({ ...CLEAR, APP_LOG_LEVEL: "verbose" }, () => loadConfig()),
    /invalid logLevel: verbose/
  );
}

// 5. empty string counts as unset
{
  const cfg = withEnv({ ...CLEAR, APP_PORT: "" }, () => loadConfig({ port: 1234 }));
  assert.strictEqual(cfg.port, 1234);
}

// 6. maxRetries coercion + validation
{
  const cfg = withEnv({ ...CLEAR, APP_MAX_RETRIES: "5" }, () => loadConfig());
  assert.strictEqual(cfg.maxRetries, 5);
  assert.throws(
    () => withEnv({ ...CLEAR, APP_MAX_RETRIES: "99" }, () => loadConfig()),
    /invalid maxRetries: 99/
  );
}

console.log("config-loader: all tests passed");
