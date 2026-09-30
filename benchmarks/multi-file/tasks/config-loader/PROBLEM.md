# Task: config-loader — add env-var overrides with validation

`loader.js` merges `DEFAULTS` with a file-provided config object. Add
environment-variable overrides as the highest-precedence layer:

1. Read `process.env.APP_PORT`, `APP_HOST`, `APP_LOG_LEVEL`, `APP_MAX_RETRIES`.
2. Map them to config keys: `APP_PORT`→`port`, `APP_HOST`→`host`,
   `APP_LOG_LEVEL`→`logLevel`, `APP_MAX_RETRIES`→`maxRetries`.
3. Coerce `port` and `maxRetries` from string to number
   (use `Number(...)`; an empty string counts as unset — ignore it).
4. Validate every override with the matching function in `VALIDATORS`
   (imported from `validators.js`). On failure throw
   `Error("invalid <key>: <value>")` with the raw env string as `<value>`.
5. Unset env vars are ignored. Precedence: defaults < fileConfig < env.

Modify only `loader.js`. Do not modify `test.js`, `defaults.js`, or
`validators.js`.
