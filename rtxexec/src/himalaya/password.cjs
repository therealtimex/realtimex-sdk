"use strict";

// Private Himalaya auth-command endpoint. Only the trusted outer runner supplies
// these variables; it strips terminal/API control credentials before spawning.
function passwordForBinding(bindingId, env) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(bindingId || "") ||
      bindingId !== env.RTX_HIMALAYA_BINDING_ID) {
    throw new Error("EMAIL_BINDING_MISMATCH");
  }
  const value = env.RTX_HIMALAYA_PASSWORD;
  if (typeof value !== "string" || !value || /[\r\n\0]/.test(value) ||
      Buffer.byteLength(value) > 65536) {
    throw new Error("EMAIL_PASSWORD_INVALID");
  }
  return value;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3 || process.stdout.isTTY) {
      throw new Error("EMAIL_AUTH_PIPE_REQUIRED");
    }
    process.stdout.write(passwordForBinding(process.argv[2], process.env) + "\n");
  } catch {
    // Never print environment, value, argv, error objects, or stack traces.
    process.stderr.write("Email authentication helper is unavailable for this invocation.\n");
    process.exitCode = 1;
  }
}

module.exports = { passwordForBinding };
