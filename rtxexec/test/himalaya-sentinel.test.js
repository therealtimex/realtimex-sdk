import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import runner from "../src/himalaya/runner.cjs";

const binary = process.env.HIMALAYA_TEST_BIN;
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
test("installed Himalaya consumes the fixed helper privately before and after sentinel rotation",
  { skip: !binary || process.platform === "win32", timeout: 20000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "rtx-email-sentinel-"));
  const sockets = new Set();
  let expected = " " + randomUUID() + " é ";
  const authEvents = [];
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.setTimeout(5000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.write("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] Disposable fixture\r\n");
    let buffer = ""; let authenticated = false; let commands = 0; let pendingTag;
    const authenticate = (tag, user, supplied) => {
      const actual = Buffer.from(supplied); const wanted = Buffer.from(expected);
      authenticated = user === "fixture@example.test" && actual.length === wanted.length && timingSafeEqual(actual, wanted);
      authEvents.push({ authenticated, configuredBindingConsumed: authenticated });
      socket.write(tag + (authenticated ? " OK Authentication completed\r\n" : " NO [AUTHENTICATIONFAILED] Rejected\r\n"));
    };
    const plain = (tag, payload) => {
      const fields = Buffer.from(payload, "base64").toString("utf8").split("\0");
      authenticate(tag, fields[1], fields[2] || "");
    };
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > 16384) return socket.destroy();
      for (;;) {
        const at = buffer.indexOf("\r\n"); if (at < 0) break;
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 2);
        if (++commands > 32) return socket.destroy();
        if (pendingTag) { const tag = pendingTag; pendingTag = null; plain(tag, line); continue; }
        const match = line.match(/^([A-Za-z0-9._:-]{1,64}) ([A-Za-z]+)(?: (.*))?$/);
        if (!match) return socket.destroy();
        const [, tag, rawCommand, rest = ""] = match; const command = rawCommand.toUpperCase();
        if (command === "CAPABILITY") socket.write("* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n" + tag + " OK Capability\r\n");
        else if (command === "AUTHENTICATE" && /^PLAIN(?: |$)/i.test(rest)) {
          const payload = rest.slice(5).trim();
          if (payload) plain(tag, payload); else { pendingTag = tag; socket.write("+ \r\n"); }
        } else if (command === "LOGIN") {
          const tokens = rest.match(/"(?:\\.|[^"\\])*"|\S+/g) || [];
          const unquote = value => value?.startsWith('"') ? value.slice(1, -1).replace(/\\(.)/g, "$1") : value;
          authenticate(tag, unquote(tokens[0]), unquote(tokens[1]) || "");
        } else if (["LIST", "LSUB"].includes(command) && authenticated) {
          socket.write('* ' + command + ' (\\HasNoChildren) "/" "INBOX"\r\n* ' + command + ' (\\HasNoChildren) "/" "Archive"\r\n' + tag + ' OK Listed\r\n');
        } else if (command === "NOOP") socket.write(tag + " OK Noop\r\n");
        else if (command === "LOGOUT") socket.end("* BYE Closing\r\n" + tag + " OK Logout\r\n");
        else socket.write(tag + " BAD Unsupported fixture operation\r\n"); // No SELECT/FETCH or mutation.
      }
    });
  });
  t.after(async () => { for (const socket of sockets) socket.destroy(); if (server.listening) await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const configPath = path.join(directory, "config.toml");
  const bindingId = "sentinel-binding";
  const command = [process.execPath, fileURLToPath(new URL("../src/himalaya/password.cjs", import.meta.url)), bindingId].map(shellQuote).join(" ");
  const config = '[accounts.fixture]\nemail = "fixture@example.test"\ndefault = true\nbackend.type = "imap"\nbackend.host = "127.0.0.1"\nbackend.port = ' + server.address().port +
    '\nbackend.encryption.type = "none"\nbackend.login = "fixture@example.test"\nbackend.auth.type = "password"\nbackend.auth.cmd = ' + JSON.stringify(command) + "\n";
  writeFileSync(configPath, config, { mode: 0o600, flag: "wx" });
  const plan = { binary, operation: "folders", account: "fixture", configPaths: [configPath], bindingId,
    targetRevision: "isolated-target", bindingRevision: "rotation-1" };
  const environment = { ...process.env, HOME: directory, XDG_CONFIG_HOME: directory };
  const first = await runner.runHimalaya(plan, { password: expected, environment, timeoutMs: 5000 });
  assert.ok(first.ok && Array.isArray(first.data) && first.data.some(folder => folder.name === "INBOX"));
  assert.ok(authEvents.some(event => event.authenticated));
  assert.ok(!readFileSync(configPath, "utf8").includes(expected));
  assert.ok(!JSON.stringify(first).includes(expected));
  const firstCount = authEvents.length;
  expected = " " + randomUUID() + " é ";
  const second = await runner.runHimalaya({ ...plan, bindingRevision: "rotation-2" }, { password: expected, environment, timeoutMs: 5000 });
  assert.ok(second.ok);
  assert.ok(authEvents.slice(firstCount).some(event => event.authenticated));
  assert.ok(!readFileSync(configPath, "utf8").includes(expected));
  assert.ok(!JSON.stringify(second).includes(expected));
  assert.equal(second.bindingRevision, "rotation-2");
  assert.equal(readFileSync(configPath, "utf8"), config);

  // Exercise an existing-style password-store helper through the real binary.
  // Its required runtime location survives; no injected Secrets value or host
  // control credential does. The synthetic store is private and disposable.
  const storePath = path.join(directory, "entry");
  writeFileSync(storePath, expected, { mode: 0o600, flag: "wx" });
  const unmanagedHelper = path.join(directory, "store-helper.cjs");
  writeFileSync(unmanagedHelper, `"use strict";
const fs = require("node:fs");
const path = require("node:path");
if (!process.env.PASSWORD_STORE_DIR || !process.env.GNUPGHOME ||
    process.env.RTX_HIMALAYA_PASSWORD || process.env.RTX_HIMALAYA_BINDING_ID ||
    process.env.REALTIMEX_TERMINAL_SESSION_TOKEN) process.exit(1);
process.stdout.write(fs.readFileSync(path.join(process.env.PASSWORD_STORE_DIR, "entry"), "utf8") + "\\n");
`, { mode: 0o600, flag: "wx" });
  const unmanagedCommand = [process.execPath, unmanagedHelper].map(shellQuote).join(" ");
  const unmanagedConfig = config.replace(JSON.stringify(command), JSON.stringify(unmanagedCommand));
  writeFileSync(configPath, unmanagedConfig, { mode: 0o600 });
  const beforeUnmanaged = authEvents.length;
  const unmanaged = await runner.runHimalaya({ ...plan, bindingId: undefined }, {
    environment: { ...environment, PASSWORD_STORE_DIR: directory, GNUPGHOME: directory,
      REALTIMEX_TERMINAL_SESSION_TOKEN: randomUUID(), RTX_HIMALAYA_PASSWORD: randomUUID() }, timeoutMs: 5000
  });
  assert.ok(unmanaged.ok && authEvents.slice(beforeUnmanaged).some(event => event.authenticated));
  assert.equal(readFileSync(configPath, "utf8"), unmanagedConfig);
  // Real IMAP auth rejection is distinct from Secrets access and connection.
  writeFileSync(configPath, config, { mode: 0o600 });
  await assert.rejects(runner.runHimalaya(plan, { password: randomUUID(), environment, timeoutMs: 5000 }), { code: "EMAIL_AUTH_FAILED" });
});
