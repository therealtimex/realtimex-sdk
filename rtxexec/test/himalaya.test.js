import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import runner from "../src/himalaya/runner.cjs";
import helper from "../src/himalaya/password.cjs";

const plan = () => ({ operation: "folders", account: "fixture", configPaths: [process.platform === "win32" ? "\\\\fixture\\rtx\\config.toml" : fileURLToPath(new URL("./fixture.toml", import.meta.url))],
  binary: process.execPath, bindingId: "binding-123", targetRevision: "target-rev", bindingRevision: "binding-rev" });
const password = () => "  " + randomUUID() + " é  ";

function fakeSpawn({ version = "himalaya v1.2.0\n", data, stderr, exitCode = 0, hang = false } = {}) {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    calls.push({ binary, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { setImmediate(() => { child.stdout.end(); child.stderr.end(); child.emit("close", null); }); };
    setImmediate(() => {
      child.emit("spawn");
      if (args[0] === "--version") { child.stdout.end(version); child.stderr.end(); child.emit("close", 0); }
      else if (!hang) {
        child.stdout.end(JSON.stringify(data || [{ name: "INBOX" }]));
        child.stderr.end(stderr || "");
        child.emit("close", exitCode);
      }
    });
    return child;
  };
  return { spawnImpl, calls };
}

test("fixed helper preserves whitespace inside the auth pipe and rejects another binding", () => {
  const value = password();
  assert.ok(helper.passwordForBinding("binding-123", { RTX_HIMALAYA_BINDING_ID: "binding-123", RTX_HIMALAYA_PASSWORD: value }) === value);
  for (const invalid of ["", "\r", "\n", "a\0b"]) {
    assert.throws(() => helper.passwordForBinding("binding-123", { RTX_HIMALAYA_BINDING_ID: "binding-123", RTX_HIMALAYA_PASSWORD: invalid }), /EMAIL_PASSWORD_INVALID/);
  }
  assert.throws(() => helper.passwordForBinding("other", { RTX_HIMALAYA_BINDING_ID: "binding-123", RTX_HIMALAYA_PASSWORD: value }), /EMAIL_BINDING_MISMATCH/);
  const output = execFileSync(process.execPath, [fileURLToPath(new URL("../src/himalaya/password.cjs", import.meta.url)), "binding-123"],
    { env: { RTX_HIMALAYA_BINDING_ID: "binding-123", RTX_HIMALAYA_PASSWORD: value }, stdio: ["ignore", "pipe", "pipe"] }).toString();
  assert.ok(output === value + "\n"); // Only in-memory synthetic fixture comparison.
});

test("runner probes version without a credential then injects only the selected child", async () => {
  const value = password();
  const f = fakeSpawn();
  const result = await runner.runHimalaya(plan(), { password: value, spawnImpl: f.spawnImpl, environment: {
    PATH: "/safe/bin", HOME: "/fixture", REALTIMEX_TERMINAL_SESSION_TOKEN: randomUUID(),
    REALTIMEX_APP_ID_AUTH: randomUUID(), OPENAI_API_KEY: randomUUID(), RTX_AGENT_CONTEXT_JSON: "{}"
  } });
  assert.equal(result.code, "EMAIL_OPERATION_OK");
  assert.deepEqual(result.data, [{ name: "INBOX" }]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].options.env.RTX_HIMALAYA_PASSWORD, undefined);
  assert.ok(f.calls[1].options.env.RTX_HIMALAYA_PASSWORD === value);
  assert.equal(f.calls[1].options.env.RTX_HIMALAYA_BINDING_ID, "binding-123");
  for (const call of f.calls) {
    assert.equal(call.options.shell, false);
    assert.ok(!JSON.stringify(call.args).includes(value));
    for (const key of ["REALTIMEX_TERMINAL_SESSION_TOKEN", "REALTIMEX_APP_ID_AUTH", "OPENAI_API_KEY", "RTX_AGENT_CONTEXT_JSON"])
      assert.equal(call.options.env[key], undefined);
  }
  assert.equal(result.targetRevision, "target-rev");
  assert.equal(result.bindingRevision, "binding-rev");
});

test("outward JSON masks known values while private helper authentication stays exact", async () => {
  const value = password();
  const f = fakeSpawn({ data: { name: value, encoded: Buffer.from(value).toString("base64") }, stderr: value });
  const result = await runner.runHimalaya(plan(), { password: value, spawnImpl: f.spawnImpl });
  assert.deepEqual(result.data, { name: "[redacted]", encoded: "[redacted]" });
  assert.ok(!JSON.stringify(result).includes(value));
});

test("unsupported version and invalid credentials launch no authenticated command", async () => {
  const f = fakeSpawn({ version: "himalaya v2.0.0\n" });
  await assert.rejects(runner.runHimalaya(plan(), { password: password(), spawnImpl: f.spawnImpl }), { code: "EMAIL_VERSION_UNSUPPORTED" });
  assert.equal(f.calls.length, 1);
  const g = fakeSpawn();
  await assert.rejects(runner.runHimalaya(plan(), { password: "a\nb", spawnImpl: g.spawnImpl }), { code: "EMAIL_PASSWORD_INVALID" });
  assert.equal(g.calls.length, 0);
});

test("operations use bounded argument arrays and reject arbitrary commands", () => {
  const p = plan();
  assert.throws(() => runner.operationArgs({ ...p, configPaths: ["C:\\fixture\\config.toml"] }), { code: "EMAIL_PLATFORM_UNSUPPORTED" });
  assert.deepEqual(runner.operationArgs(p).slice(0, 2), ["folder", "list"]);
  assert.throws(() => runner.operationArgs({ ...p, operation: "delete", args: ["--all"] }), { code: "EMAIL_OPERATION_UNSUPPORTED" });
  assert.throws(() => runner.operationArgs({ ...p, operation: "move", from: "INBOX", to: "--delete", uids: [1] }), { code: "EMAIL_OPERATION_INVALID" });
  assert.throws(() => runner.operationArgs({ ...p, operation: "move", from: "INBOX", to: "Archive", uids: ["1;echo"] }), { code: "EMAIL_OPERATION_INVALID" });
  for (const query of ["--trace", "--account other", "-c /other/config.toml", "  --debug"]) {
    assert.throws(() => runner.operationArgs({ ...p, operation: "envelopes", folder: "INBOX", page: 1, pageSize: 10, query }), { code: "EMAIL_OPERATION_INVALID" });
  }
  const query = "subject -invoice";
  assert.ok(runner.operationArgs({ ...p, operation: "envelopes", folder: "INBOX", page: 1, pageSize: 10, query }).includes(query));
  const move = runner.operationArgs({ ...p, operation: "move", from: "INBOX", to: "Archive", uids: [1, 2] });
  assert.deepEqual(move.slice(0, 7), ["message", "move", "-f", "INBOX", "Archive", "1", "2"]);
});

test("unmanaged accounts keep their selected auth command without an injected password", async () => {
  const f = fakeSpawn();
  await runner.runHimalaya({ ...plan(), bindingId: undefined }, { spawnImpl: f.spawnImpl, environment: {
    PASSWORD_STORE_DIR: "/fixture/password-store", GNUPGHOME: "/fixture/gnupg",
    REALTIMEX_TERMINAL_SESSION_TOKEN: randomUUID(), RTX_HIMALAYA_PASSWORD: password()
  } });
  assert.ok(f.calls.every(call => call.options.env.RTX_HIMALAYA_PASSWORD === undefined));
  assert.ok(f.calls.every(call => call.options.env.PASSWORD_STORE_DIR === "/fixture/password-store" &&
    call.options.env.GNUPGHOME === "/fixture/gnupg" && call.options.env.REALTIMEX_TERMINAL_SESSION_TOKEN === undefined));
  const managed = runner.childEnvironment({ PASSWORD_STORE_DIR: "/fixture/password-store", GNUPGHOME: "/fixture/gnupg" });
  assert.equal(managed.PASSWORD_STORE_DIR, undefined);
  assert.equal(managed.GNUPGHOME, undefined);
  await assert.rejects(runner.runHimalaya({ ...plan(), bindingId: undefined }, { password: password(), spawnImpl: f.spawnImpl }), { code: "EMAIL_BINDING_MISMATCH" });
});

test("private diagnostics produce distinct fixed repair codes without outward text", async () => {
  for (const [diagnostic, code] of [
    ["Cannot login to IMAP server: AUTHENTICATIONFAILED", "EMAIL_AUTH_FAILED"],
    ["Cannot connect: connection refused", "EMAIL_NETWORK_FAILED"],
    ["TLS handshake: invalid peer certificate", "EMAIL_TLS_FAILED"],
    ["TOML parse error at line 4", "EMAIL_CONFIG_INVALID"],
    ["Unknown account fixture", "EMAIL_ACCOUNT_MISSING"],
    ["Cannot get password from command", "EMAIL_CREDENTIAL_COMMAND_FAILED"],
    ["Page 2 out of bound", "EMAIL_PAGE_OUT_OF_RANGE"],
    ["Something else happened", "EMAIL_COMMAND_FAILED"]
  ]) {
    const value = password();
    await assert.rejects(runner.runHimalaya(plan(), { password: value,
      spawnImpl: fakeSpawn({ stderr: diagnostic + " " + value, exitCode: 1 }).spawnImpl }), error => {
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      assert.deepEqual(Object.keys(error), ["code"]);
      assert.ok(!error.stack.includes(value));
      return true;
    });
  }
});

test("mutation success returns no child text and spawn exceptions are fixed", async () => {
  const value = password();
  const p = { ...plan(), operation: "move", from: "INBOX", to: "Archive", uids: [1] };
  const result = await runner.runHimalaya(p, { password: value, spawnImpl: fakeSpawn({ data: { echoed: value } }).spawnImpl });
  assert.equal(result.data, null); assert.ok(!JSON.stringify(result).includes(value));
  await assert.rejects(runner.runHimalaya(plan(), { password: value, spawnImpl: () => { throw new Error(value); } }), error => {
    assert.equal(error.code, "EMAIL_BINARY_UNAVAILABLE"); assert.ok(!error.stack.includes(value)); return true;
  });
});

test("execution-start hook excludes the probe and failed authentication spawn", async () => {
  let starts = 0;
  const f = fakeSpawn();
  await runner.runHimalaya(plan(), { password: password(), spawnImpl: f.spawnImpl,
    onExecutionStart: () => { starts++; assert.equal(f.calls.length, 2); } });
  assert.equal(starts, 1);
  const g = fakeSpawn();
  await assert.rejects(runner.runHimalaya(plan(), { password: password(),
    onExecutionStart: () => { starts++; }, spawnImpl: (...args) => {
      if (args[1][0] === "--version") return g.spawnImpl(...args);
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      setImmediate(() => child.emit("error", new Error("fixture launch failure")));
      return child;
    } }), { code: "EMAIL_BINARY_UNAVAILABLE" });
  assert.equal(starts, 1);
});

test("cancellation, deadline and output ceiling return safe fixed errors", async () => {
  const controller = new AbortController();
  const f = fakeSpawn({ hang: true });
  const running = runner.runHimalaya(plan(), { password: password(), signal: controller.signal, spawnImpl: f.spawnImpl });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(running, { code: "EMAIL_OPERATION_CANCELLED" });
  await assert.rejects(runner.runHimalaya(plan(), { password: password(), timeoutMs: 20, spawnImpl: fakeSpawn({ hang: true }).spawnImpl }), { code: "EMAIL_OPERATION_TIMEOUT" });
  await assert.rejects(runner.runHimalaya(plan(), { password: password(), maxOutputBytes: 8, spawnImpl: fakeSpawn().spawnImpl }), { code: "EMAIL_OUTPUT_LIMIT" });
});

test("target revision drift during a version probe prevents authentication", { skip: process.platform === "win32" }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "rtx-target-revision-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.toml");
  const config = '[accounts.fixture]\nemail = "fixture@example.test"\n';
  writeFileSync(configPath, config, { mode: 0o600 });
  const revision = createHash("sha256").update(config).digest("hex");
  const p = { ...plan(), configPaths: [configPath], configRevisions: [{ path: configPath, revision }] };
  const f = fakeSpawn(); let validations = 0;
  await assert.rejects(runner.runHimalaya(p, { password: password(), spawnImpl: f.spawnImpl,
    validateAdmission: async () => { if (++validations === 2) writeFileSync(configPath, config + "# changed\n"); }
  }), { code: "EMAIL_TARGET_CHANGED" });
  assert.equal(f.calls.length, 1);
  const g = fakeSpawn();
  await assert.rejects(runner.runHimalaya(p, { password: password(), spawnImpl: g.spawnImpl }), { code: "EMAIL_TARGET_CHANGED" });
  assert.equal(g.calls.length, 0);
});
