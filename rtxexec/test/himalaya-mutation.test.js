import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import runner from "../src/himalaya/runner.cjs";
import { runTerminalHimalaya, executionContract, himalayaFailureResult } from "../src/himalaya/terminal.js";
import { main } from "../src/cli.js";

const request = { pluginId: "241bb574-5b45-4b0e-a43d-9d8ade54339e", account: "fixture",
  bindingId: "binding-123", operation: "move", from: "INBOX", to: "Archive", uids: ["1"] };
const env = { REALTIMEX_BASE_URL: "http://127.0.0.1:12345/api/cli",
  REALTIMEX_TERMINAL_SESSION_TOKEN: "synthetic-terminal-token" };

function fixture(t, { denyBefore = false, denyAfterEffect = false, hang = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "rtx-email-mutation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const marker = path.join(directory, "disposable-effect.txt");
  const script = path.join(directory, "owned-fixture.cjs");
  writeFileSync(script, `
if (process.argv[2] === "--version") console.log("himalaya v1.2.0");
else {
  require("node:fs").appendFileSync(${JSON.stringify(marker)}, "moved\\n");
  ${hang ? "setInterval(() => {}, 1000);" : 'console.log("child success");'}
}
`, { mode: 0o600, flag: "wx" });
  const configPath = path.join(directory, "config.toml");
  writeFileSync(configPath, "# isolated disposable fixture\n", { mode: 0o600, flag: "wx" });
  const password = randomUUID(); const operationId = randomUUID();
  let admissions = 0; let executions = 0;
  const fetchImpl = async url => {
    if (url.pathname.endsWith("/admit")) {
      admissions++;
      return new Response(JSON.stringify({ success: true, contractVersion: executionContract,
        operationId, expiresAt: new Date(Date.now() + 120000).toISOString(), password,
        plan: { ...request, binary: process.execPath, configPaths: [configPath],
          configRevisions: [{ path: configPath, revision: "a".repeat(64) }],
          targetRevision: "b".repeat(64), bindingRevision: "c".repeat(64) } }));
    }
    if (denyBefore || denyAfterEffect && existsSync(marker))
      return new Response(JSON.stringify({ success: false, code: "EMAIL_CONTEXT_UNAVAILABLE", error: password }), { status: 401 });
    return new Response(JSON.stringify({ success: true, contractVersion: executionContract, operationId }));
  };
  const run = async (plan, options) => {
    // Target hash validation has independent tests; this owned launcher uses
    // the real runner/spawn lifecycle and a local file instead of a mailbox.
    return runner.runHimalaya({ ...plan, configRevisions: undefined }, { ...options,
      spawnImpl: (binary, args, childOptions) => {
        if (args[0] !== "--version") executions++;
        return spawn(binary, [script, ...args], childOptions);
      } });
  };
  return { marker, password, operationId, fetchImpl, run,
    counts: () => ({ admissions, executions }) };
}

test("context loss after a disposable move starts retains an uncertain identity without replay", {
  skip: process.platform === "win32", timeout: 8000
}, async t => {
  const f = fixture(t, { denyAfterEffect: true, hang: true });
  await assert.rejects(runTerminalHimalaya(request, env, { fetchImpl: f.fetchImpl, run: f.run,
    signalSource: new EventEmitter(), revalidateMs: 5 }), error => {
    assert.deepEqual(himalayaFailureResult(error), { ok: false, code: "EMAIL_CONTEXT_UNAVAILABLE",
      operationId: f.operationId, outcome: "uncertain" });
    assert.ok(!JSON.stringify(error).includes(f.password)); return true;
  });
  assert.equal(readFileSync(f.marker, "utf8"), "moved\n");
  assert.deepEqual(f.counts(), { admissions: 1, executions: 1 });
});

test("final validation denial after child success produces the original uncertain CLI receipt", {
  skip: process.platform === "win32", timeout: 8000
}, async t => {
  const f = fixture(t, { denyAfterEffect: true }); let output = ""; let errors = "";
  const code = await main(["himalaya", "--plugin", request.pluginId, "--account", request.account,
    "--binding", request.bindingId, "--operation", "move", "--from", "INBOX", "--to", "Archive", "--uids", "1"], {
    env, stdout: new Writable({ write(chunk, encoding, done) { output += chunk; done(); } }),
    stderr: new Writable({ write(chunk, encoding, done) { errors += chunk; done(); } }),
    emailRunner: input => runTerminalHimalaya(input, env, { fetchImpl: f.fetchImpl, run: f.run,
      signalSource: new EventEmitter(), revalidateMs: 100000 })
  });
  assert.equal(code, 1); assert.equal(errors, "");
  assert.deepEqual(JSON.parse(output), { ok: false, code: "EMAIL_CONTEXT_UNAVAILABLE",
    operationId: f.operationId, outcome: "uncertain" });
  assert.ok(!output.includes(f.password));
  assert.equal(readFileSync(f.marker, "utf8"), "moved\n");
  assert.deepEqual(f.counts(), { admissions: 1, executions: 1 });
});

test("pre-launch denial records not_started while confirmed mutation keeps the admitted identity", {
  skip: process.platform === "win32", timeout: 8000
}, async t => {
  const denied = fixture(t, { denyBefore: true });
  await assert.rejects(runTerminalHimalaya(request, env, { fetchImpl: denied.fetchImpl, run: denied.run,
    signalSource: new EventEmitter() }), error => {
    assert.deepEqual(himalayaFailureResult(error), { ok: false, code: "EMAIL_CONTEXT_UNAVAILABLE",
      operationId: denied.operationId, outcome: "not_started" }); return true;
  });
  assert.equal(existsSync(denied.marker), false);
  assert.deepEqual(denied.counts(), { admissions: 1, executions: 0 });
  const confirmed = fixture(t);
  const result = await runTerminalHimalaya(request, env, { fetchImpl: confirmed.fetchImpl, run: confirmed.run,
    signalSource: new EventEmitter() });
  assert.equal(result.outcome, "confirmed"); assert.equal(result.operationId, confirmed.operationId);
  assert.equal(result.data, null);
  assert.equal(readFileSync(confirmed.marker, "utf8"), "moved\n");
});

test("arbitrary exception properties cannot forge an outward mutation receipt", () => {
  const error = Object.assign(new Error(randomUUID()), { code: "EMAIL_AUTH_FAILED",
    operationId: randomUUID(), outcome: "uncertain" });
  assert.deepEqual(himalayaFailureResult(error), { ok: false, code: "EMAIL_AUTH_FAILED" });
});
