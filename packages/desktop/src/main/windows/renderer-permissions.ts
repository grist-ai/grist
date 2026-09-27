// Permissions the renderer is allowed to request through Electron's
// setPermissionRequestHandler / setPermissionCheckHandler.
//
// Kept in its own module (no Electron imports) so the regression test can
// import it directly. Dropping "media"/"microphone" here makes every
// getUserMedia({ audio: true }) call fail with NotAllowedError —
// that is exactly what broke voice input in the v2 port (2026-09-27).
export const rendererPermissions = new Set([
  "clipboard-sanitized-write",
  "notifications",
  "media",
  "microphone",
])
