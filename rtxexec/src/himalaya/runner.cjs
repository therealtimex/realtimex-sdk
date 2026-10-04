"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { passwordForBinding } = require("./password.cjs");

const failure = (code) => Object.assign(new Error(code), { code });
const namePattern = /^[a-zA-Z0-9_-]{1,80}$/;
const validFolder = (value) => typeof value === "string" && value.length > 0 &&
  value.length <= 200 && !/[\r\n\0]/.test(value) && !value.startsWith("-");
const envKeys = ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot",
  "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TZ",
  "XDG_CONFIG_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR"];
// Compatibility inputs for existing pass/GnuPG and desktop keyring helpers.
// These locate stores/services; they are not RealTimeX authority or passwords.
const unmanagedEnvKeys = ["PASSWORD_STORE_DIR", "PASSWORD_STORE_GPG_OPTS",
  "GNUPGHOME", "GPG_TTY", "SSH_AUTH_SOCK", "DBUS_SESSION_BUS_ADDRESS",
  "XDG_RUNTIME_DIR", "DISPLAY", "WAYLAND_DISPLAY"];

function childEnvironment(environment = {}, { unmanaged = false } = {}) {
  const result = {};
  for (const key of [...envKeys, ...(unmanaged ? unmanagedEnvKeys : [])])
    if (typeof environment[key] === "string") result[key] = environment[key];
  result.RUST_LOG = "off";
  result.RUST_BACKTRACE = "0";
  return result;
}

function operationArgs(plan) {
  // v1.2.0's clap config parser splits on ':' even on Windows. Do not turn
  // an admitted drive path into two different targets. A Windows adapter needs
  // separate version/build proof before accepting that path representation.
  if (Array.isArray(plan?.configPaths) && plan.configPaths.some(file => typeof file === "string" && /^[A-Za-z]:/.test(file)))
    throw failure("EMAIL_PLATFORM_UNSUPPORTED");
  if (!plan || !namePattern.test(plan.account || "") ||
      !Array.isArray(plan.configPaths) || !plan.configPaths.length ||
      plan.configPaths.length > 8 ||
      plan.configPaths.some((file) => typeof file !== "string" || !path.isAbsolute(file) || file.length > 4096 || /[\r\n\0:]/.test(file))) {
    throw failure("EMAIL_TARGET_INVALID");
  }
  let args;
  switch (plan.operation) {
    case "folders": args = ["folder", "list"]; break;
    case "envelopes":
      if (!validFolder(plan.folder) || !Number.isInteger(plan.page) || plan.page < 1 ||
          plan.page > 10000 || !Number.isInteger(plan.pageSize) || plan.pageSize < 1 || plan.pageSize > 500 ||
          plan.query !== undefined && (typeof plan.query !== "string" || plan.query.length > 4096 || /[\r\n\0]/.test(plan.query) || /^\s*-/.test(plan.query))) {
        throw failure("EMAIL_OPERATION_INVALID");
      }
      args = ["envelope", "list", "-f", plan.folder, "-p", String(plan.page), "-s", String(plan.pageSize)];
      if (plan.query) args.push(plan.query);
      break;
    case "move":
      if (!validFolder(plan.from) || !validFolder(plan.to) ||
          !Array.isArray(plan.uids) || !plan.uids.length || plan.uids.length > 200 ||
          plan.uids.some((uid) => !/^[1-9][0-9]{0,15}$/.test(String(uid)))) throw failure("EMAIL_OPERATION_INVALID");
      args = ["message", "move", "-f", plan.from, plan.to, ...plan.uids.map(String)];
      break;
    case "add-folder":
      if (!validFolder(plan.folder)) throw failure("EMAIL_OPERATION_INVALID");
      args = ["folder", "add", plan.folder]; break;
    default: throw failure("EMAIL_OPERATION_UNSUPPORTED");
  }
  return [...args, "-a", plan.account, "-o", "json", "-c", plan.configPaths.join(":")];
}

function maskOutput(value, password) {
  if (!password) return value;
  const variants = [...new Set([password, encodeURIComponent(password),
    Buffer.from(password).toString("base64"), JSON.stringify(password).slice(1, -1)])]
    .sort((a, b) => b.length - a.length);
  let output = value;
  for (const variant of variants) output = output.split(variant).join("[redacted]");
  return output;
}

// Consume only bounded private diagnostic text. Never attach it to an Error
// or a returned result: callers choose repair copy from this fixed code set.
function failureCode(stderr) {
  const diagnostic = stderr.toLowerCase();
  if (/out of bound|page.{0,40}out of range/s.test(diagnostic)) return "EMAIL_PAGE_OUT_OF_RANGE";
  if (/unknown account|account.{0,80}(not found|does not exist|cannot find)/s.test(diagnostic)) return "EMAIL_ACCOUNT_MISSING";
  if (/toml parse|toml (error|deserialize)|cannot (read|parse).{0,80}config|failed to (read|parse).{0,80}config|invalid.{0,40}configuration/s.test(diagnostic)) return "EMAIL_CONFIG_INVALID";
  if (/cannot (get|read).{0,30}password|failed to (get|read).{0,30}password|password command.{0,40}(failed|not found)|email password helper unavailable/s.test(diagnostic)) return "EMAIL_CREDENTIAL_COMMAND_FAILED";
  if (/certificate|tls handshake|ssl handshake|invalid peer|unknownissuer|unknown issuer/.test(diagnostic)) return "EMAIL_TLS_FAILED";
  if (/connection refused|connection reset|network is unreachable|no route to host|failed to resolve|dns error|name or service not known|connection timed out|connect error/.test(diagnostic)) return "EMAIL_NETWORK_FAILED";
  if (/authenticationfailed|authentication failed|authentication rejected|invalid credentials|invalid password|cannot (authenticate|login)|failed to (authenticate|login)|login failed|authfailed/.test(diagnostic)) return "EMAIL_AUTH_FAILED";
  return "EMAIL_COMMAND_FAILED";
}

function capture(binary, args, env, { signal, timeoutMs, maxOutputBytes, spawnImpl = spawn }) {
  if (signal?.aborted) return Promise.reject(failure("EMAIL_OPERATION_CANCELLED"));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(binary, args, { env, shell: false, windowsHide: true,
        detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    } catch { reject(failure("EMAIL_BINARY_UNAVAILABLE")); return; }
    let stdout = [];
    let stderr = [];
    let bytes = 0;
    let code = null;
    let killTimer;
    const kill = () => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch { /* Already exited. */ }
      killTimer = setTimeout(() => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch { /* Already exited. */ }
      }, 1000);
      killTimer.unref?.();
    };
    const stop = (reason) => { if (!code) { code = reason; kill(); } };
    const cancelled = () => stop("EMAIL_OPERATION_CANCELLED");
    const timer = setTimeout(() => stop("EMAIL_OPERATION_TIMEOUT"), timeoutMs);
    signal?.addEventListener("abort", cancelled, { once: true });
    const output = (chunk, keep) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) stop("EMAIL_OUTPUT_LIMIT");
      else if (!code) (keep ? stdout : stderr).push(Buffer.from(chunk));
    };
    child.stdout.on("data", (chunk) => output(chunk, true));
    child.stderr.on("data", (chunk) => output(chunk, false));
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", cancelled);
    };
    child.once("error", () => { cleanup(); stdout = []; stderr = []; reject(failure("EMAIL_BINARY_UNAVAILABLE")); });
    child.once("close", (exitCode) => {
      // A terminated parent can close its streams while an auth helper remains
      // in the detached group. Finish termination before clearing the deadline.
      if (code && process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Group already exited. */ }
      }
      cleanup();
      if (code || exitCode !== 0) {
        const safeCode = code || failureCode(Buffer.concat(stderr).toString("utf8"));
        stdout = []; stderr = []; reject(failure(safeCode));
      } else { stderr = []; resolve(Buffer.concat(stdout).toString("utf8")); }
    });
    if (signal?.aborted) cancelled();
  });
}

function verifyTarget(plan) {
  if (plan.configRevisions === undefined) return; // Legacy unmanaged callers.
  if (!Array.isArray(plan.configRevisions) || plan.configRevisions.length !== plan.configPaths.length)
    throw failure("EMAIL_TARGET_INVALID");
  for (let i = 0; i < plan.configPaths.length; i++) {
    const expected = plan.configRevisions[i];
    if (expected?.path !== plan.configPaths[i] || !/^[a-f0-9]{64}$/.test(expected.revision || ""))
      throw failure("EMAIL_TARGET_INVALID");
    try {
      const stat = fs.statSync(expected.path);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw failure("EMAIL_TARGET_CHANGED");
      const revision = createHash("sha256").update(fs.readFileSync(expected.path)).digest("hex");
      if (revision !== expected.revision) throw failure("EMAIL_TARGET_CHANGED");
    } catch { throw failure("EMAIL_TARGET_CHANGED"); }
  }
}

// Both host and terminal entries admit/validate the binding and exact target
// before calling this runner. No arbitrary command or user-authored code entry.
async function runHimalaya(plan, { password, environment = process.env, signal,
  timeoutMs = 120000, maxOutputBytes = 1024 * 1024, spawnImpl = spawn,
  validateAdmission = async () => {} } = {}) {
  const args = operationArgs(plan);
  if (typeof plan.binary !== "string" || !path.isAbsolute(plan.binary) || /[\r\n\0]/.test(plan.binary) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 ||
      !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 4 * 1024 * 1024) {
    throw failure("EMAIL_EXECUTION_INVALID");
  }
  const env = childEnvironment(environment, { unmanaged: !plan.bindingId });
  if (plan.bindingId) {
    try {
      passwordForBinding(plan.bindingId, { RTX_HIMALAYA_BINDING_ID: plan.bindingId, RTX_HIMALAYA_PASSWORD: password });
    } catch { throw failure("EMAIL_PASSWORD_INVALID"); }
  } else if (password !== undefined) throw failure("EMAIL_BINDING_MISMATCH");
  await validateAdmission();
  verifyTarget(plan);
  const options = { signal, timeoutMs: Math.min(timeoutMs, 5000), maxOutputBytes: 4096, spawnImpl };
  const version = await capture(plan.binary, ["--version"], env, options);
  if (!/^himalaya v1\.2\.0(?:\s|$)/m.test(version)) throw failure("EMAIL_VERSION_UNSUPPORTED");
  await validateAdmission();
  verifyTarget(plan);
  // The version probe never receives a password. Only this selected invocation
  // gets the credential, and another account's helper rejects its binding ID.
  const authEnv = plan.bindingId ? { ...env,
    RTX_HIMALAYA_BINDING_ID: plan.bindingId, RTX_HIMALAYA_PASSWORD: password } : env;
  const stdout = await capture(plan.binary, args, authEnv, { signal, timeoutMs, maxOutputBytes, spawnImpl });
  let data = null;
  if (["folders", "envelopes"].includes(plan.operation)) {
    const safeOutput = maskOutput(stdout, password);
    try { data = JSON.parse(safeOutput); } catch { throw failure("EMAIL_OUTPUT_INVALID"); }
  } // Mutation success needs no command text; admitted UIDs/folders are known.
  return { ok: true, code: "EMAIL_OPERATION_OK", data, account: plan.account,
    targetRevision: plan.targetRevision, bindingRevision: plan.bindingRevision, version: "1.2.0" };
}

module.exports = { runHimalaya, operationArgs, childEnvironment, maskOutput };
