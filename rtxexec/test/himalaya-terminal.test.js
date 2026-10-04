import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseHimalayaArguments, runTerminalHimalaya, executionContract } from "../src/himalaya/terminal.js";
import { main } from "../src/cli.js";

const request = { pluginId: "plugin-fixture", account: "fixture", bindingId: "binding-123", operation: "folders" };
const env = { REALTIMEX_BASE_URL: "http://127.0.0.1:12345/api/cli", REALTIMEX_TERMINAL_SESSION_TOKEN: "verified-fixture-token",
  RTX_WORKSPACE_SLUG: "spoofed", RTX_THREAD_SLUG: "spoofed" };
const revision = "a".repeat(64);
const configPath = process.platform === "win32" ? "\\\\fixture\\rtx\\config.toml" : fileURLToPath(new URL("./fixture.toml", import.meta.url));
function fixtureHost({ mutation = value => value, deniedAfter = Infinity, error } = {}) {
  const password = " " + randomUUID() + " é "; const calls = []; let validations = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (error) return new Response(JSON.stringify({ success: false, code: error, error: password }), { status: 403 });
    if (url.pathname.endsWith("/admit")) return new Response(JSON.stringify(mutation({
      success: true, contractVersion: executionContract, operationId: "operation-123", expiresAt: new Date(Date.now() + 120000).toISOString(),
      password, plan: { account: request.account, bindingId: request.bindingId, binary: process.execPath,
        configPaths: [configPath], configRevisions: [{ path: configPath, revision }], targetRevision: revision, bindingRevision: revision }
    })));
    if (++validations >= deniedAfter) return new Response(JSON.stringify({ success: false, code: "EMAIL_CONTEXT_UNAVAILABLE", error: password }), { status: 401 });
    return new Response(JSON.stringify({ success: true, contractVersion: executionContract, operationId: "operation-123" }));
  };
  return { password, fetchImpl, calls };
}

test("terminal parser admits bounded operations without target, credential reference or code arguments", () => {
  assert.deepEqual(parseHimalayaArguments(["himalaya", "--plugin", request.pluginId, "--account", "fixture", "--binding", "binding-123", "--operation", "folders"]), request);
  const base = ["himalaya", "--plugin", request.pluginId, "--account", "fixture", "--operation", "envelopes", "--folder", "INBOX", "--page", "1", "--page-size", "50"];
  assert.equal(parseHimalayaArguments([...base, "--query", "subject -invoice"]).query, "subject -invoice");
  for (const args of [
    ["--query", "--trace"], ["--config", "/tmp/other"], ["--password", randomUUID()],
    ["--workspace", "other"], ["--page", "2"]
  ]) assert.throws(() => parseHimalayaArguments([...base, ...args]));
});

test("terminal admission uses current token, passes no caller workspace and keeps values inside the runner", async () => {
  const f = fixtureHost(); const signalSource = new EventEmitter();
  const result = await runTerminalHimalaya(request, env, { fetchImpl: f.fetchImpl, signalSource,
    run: async (plan, options) => {
      assert.ok(options.password === f.password);
      assert.equal(plan.account, "fixture"); assert.equal(plan.binary, process.execPath);
      assert.equal(plan.workspaceSlug, undefined); assert.equal(plan.password, undefined);
      assert.equal(options.signal.aborted, false);
      await options.validateAdmission();
      return { ok: true, code: "EMAIL_OPERATION_OK", data: [{ name: "INBOX" }] };
    } });
  assert.deepEqual(result, { ok: true, code: "EMAIL_OPERATION_OK", data: [{ name: "INBOX" }] });
  assert.ok(f.calls.length >= 4);
  for (const { url, options } of f.calls) {
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(options.headers.Authorization, "RealtimeX-Terminal verified-fixture-token");
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    assert.equal(body.contractVersion, executionContract);
    assert.equal(body.workspaceSlug, undefined); assert.equal(body.threadSlug, undefined);
    assert.ok(!options.body.includes(f.password));
  }
  assert.ok(!JSON.stringify(result).includes(f.password));
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) assert.equal(signalSource.listenerCount(name), 0);
});

test("missing/revoked context and malformed binding/target replies launch no runner", async () => {
  let runs = 0; const run = async () => { runs++; return {}; };
  const f = fixtureHost();
  await assert.rejects(runTerminalHimalaya(request, { ...env, REALTIMEX_TERMINAL_SESSION_TOKEN: "" }, { fetchImpl: f.fetchImpl, run }), { code: "EMAIL_CONTEXT_UNAVAILABLE" });
  assert.equal(f.calls.length, 0);
  for (const mutation of [
    x => ({ ...x, contractVersion: "unknown" }),
    x => ({ ...x, expiresAt: new Date(0).toISOString() }),
    x => ({ ...x, operationId: "../other" }),
    x => ({ ...x, plan: { ...x.plan, account: "other" } }),
    x => ({ ...x, plan: { ...x.plan, bindingId: "replacement" } }),
    x => ({ ...x, plan: { ...x.plan, targetRevision: "stale" } }),
    x => ({ ...x, plan: { ...x.plan, configRevisions: [] } }),
    x => ({ ...x, password: undefined }),
    x => ({ ...x, plan: null })
  ]) await assert.rejects(runTerminalHimalaya(request, env, { fetchImpl: fixtureHost({ mutation }).fetchImpl, run }), { code: "EMAIL_CONTEXT_UNAVAILABLE" });
  await assert.rejects(runTerminalHimalaya(request, env, { fetchImpl: fixtureHost({ deniedAfter: 1 }).fetchImpl, run }), { code: "EMAIL_CONTEXT_UNAVAILABLE" });
  await assert.rejects(runTerminalHimalaya({ ...request, workspaceSlug: "spoofed" }, env, { fetchImpl: f.fetchImpl, run }), { code: "EMAIL_OPERATION_INVALID" });
  assert.equal(runs, 0);
});

test("terminal revocation cancels an active admitted process and discards its outcome", async () => {
  const f = fixtureHost({ deniedAfter: 2 }); let cancelled = false;
  await assert.rejects(runTerminalHimalaya(request, env, { fetchImpl: f.fetchImpl, revalidateMs: 5,
    run: async (plan, { signal }) => new Promise(resolve => signal.addEventListener("abort", () => {
      cancelled = true; resolve({ ok: true, data: "must not escape" });
    }, { once: true })) }), { code: "EMAIL_CONTEXT_UNAVAILABLE" });
  assert.equal(cancelled, true);
});

test("cancellation before admission or during resolution never launches the runner", async () => {
  const before = new AbortController(); before.abort(); const f = fixtureHost();
  const run = async () => assert.fail("Cancelled admission must not launch");
  await assert.rejects(runTerminalHimalaya(request, env, { fetchImpl: f.fetchImpl, run, signal: before.signal }), { code: "EMAIL_OPERATION_CANCELLED" });
  assert.equal(f.calls.length, 0);
  const during = new AbortController();
  await assert.rejects(runTerminalHimalaya(request, env, { run, signal: during.signal,
    fetchImpl: async (url, options) => { during.abort(); return f.fetchImpl(url, options); }
  }), { code: "EMAIL_OPERATION_CANCELLED" });
});

test("terminal transport forwards only known denial codes and never upstream diagnostics", async () => {
  for (const code of ["SECRET_SCOPE_DENIED", "SECRET_DISABLED", "EMAIL_BINDING_CHANGED", "untrusted-upstream-code"]) {
    const f = fixtureHost({ error: code });
    await assert.rejects(runTerminalHimalaya(request, env, { fetchImpl: f.fetchImpl }), error => {
      assert.equal(error.code, code === "untrusted-upstream-code" ? "EMAIL_CONTEXT_UNAVAILABLE" : code);
      assert.equal(error.message, error.code); assert.ok(!error.stack.includes(f.password)); return true;
    });
  }
});

test("unmanaged admission carries no password or unvalidated binding revision", async () => {
  const unmanaged = { ...request, bindingId: undefined };
  const host = fixtureHost({ mutation: x => ({ ...x, password: undefined,
    plan: { ...x.plan, bindingId: undefined, bindingRevision: undefined } }) });
  const result = await runTerminalHimalaya(unmanaged, env, { fetchImpl: host.fetchImpl,
    run: async (plan, options) => { assert.equal(options.password, undefined); return { ok: true }; } });
  assert.equal(result.ok, true);
  const invalid = fixtureHost({ mutation: x => ({ ...x, password: undefined,
    plan: { ...x.plan, bindingId: undefined, bindingRevision: { hidden: x.password } } }) });
  await assert.rejects(runTerminalHimalaya(unmanaged, env, { fetchImpl: invalid.fetchImpl,
    run: async () => { assert.fail("Unvalidated revision must prevent launch"); } }), { code: "EMAIL_CONTEXT_UNAVAILABLE" });
});

test("email CLI outputs fixed failure JSON without exception text or arbitrary codes", async () => {
  let output = ""; let errors = ""; const value = randomUUID();
  const stdout = new Writable({ write(chunk, encoding, done) { output += chunk; done(); } });
  const stderr = new Writable({ write(chunk, encoding, done) { errors += chunk; done(); } });
  const code = await main(["himalaya", "--plugin", request.pluginId, "--account", "fixture", "--binding", "binding-123", "--operation", "folders"], {
    env, stdout, stderr, emailRunner: async () => { throw Object.assign(new Error(value), { code: value }); }
  });
  assert.equal(code, 1); assert.equal(errors, "");
  assert.deepEqual(JSON.parse(output), { ok: false, code: "EMAIL_CONTEXT_UNAVAILABLE" });
  assert.ok(!output.includes(value));
});
