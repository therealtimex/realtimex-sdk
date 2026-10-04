import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import runner from "../src/himalaya/runner.cjs";

test("cancellation terminates an auth descendant even after its parent exits", {
  skip: process.platform === "win32", timeout: 8000
}, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "rtx-email-process-tree-"));
  const pidFile = path.join(directory, "owned-child.pid"); let childPid;
  t.after(() => {
    if (childPid) { try { process.kill(childPid, "SIGKILL"); } catch { /* Already exited. */ } }
    rmSync(directory, { recursive: true, force: true });
  });
  const binary = path.join(directory, "himalaya-fixture");
  writeFileSync(binary, `#!${process.execPath}
if (process.argv[2] === "--version") { console.log("himalaya v1.2.0"); }
else {
  const child = require("node:child_process").spawn(process.execPath, ["-e",
    'process.on("SIGTERM",()=>{});process.stdout.end("ready");setInterval(()=>{},1000)'],
    { stdio: ["ignore", "pipe", "ignore"] });
  child.stdout.once("data", () => require("node:fs").writeFileSync(require("node:path").join(process.env.TMPDIR, "owned-child.pid"), String(child.pid)));
  setInterval(()=>{},1000);
}
`, { mode: 0o700, flag: "wx" });
  const controller = new AbortController();
  const running = runner.runHimalaya({ binary, operation: "folders", account: "fixture",
    configPaths: [path.join(directory, "unused.toml")] }, { signal: controller.signal,
    environment: { ...process.env, TMPDIR: directory }, timeoutMs: 5000 });
  const readyUntil = Date.now() + 3000;
  while (!existsSync(pidFile) && Date.now() < readyUntil) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(existsSync(pidFile)); childPid = Number(readFileSync(pidFile, "utf8"));
  assert.ok(Number.isInteger(childPid) && childPid > 0);
  controller.abort();
  await assert.rejects(running, { code: "EMAIL_OPERATION_CANCELLED" });
  let alive = true; const deadUntil = Date.now() + 3000;
  while (alive && Date.now() < deadUntil) {
    try { process.kill(childPid, 0); } catch { alive = false; }
    if (alive) await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(alive, false);
  childPid = undefined;
});
