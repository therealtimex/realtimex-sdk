import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments, inject } from '../src/arguments.js';
import { SecretMask } from '../src/mask.js';
import { resolveEndpoint, resolveSecrets } from '../src/client.js';
import { execute, main } from '../src/cli.js';

const value = 'token-α-2120-$(do-not-execute)';
const reference = 'secret://fixture';
function output() { let text = ''; const stream = new Writable({ write(chunk, encoding, done) { text += chunk.toString(); done(); } }); return { stream, text: () => text }; }

test('only execution commands are supported and bad bindings fail early', () => {
  assert.deepEqual(parseArguments(['--env', 'TOKEN=secret://fixture', '--', 'node']), parseArguments(['run', '--env', 'TOKEN=secret://fixture', '--', 'node']));
  assert.throws(() => parseArguments(['secrets', 'list']), /management/);
  assert.throws(() => parseArguments(['run', '--env', 'TOKEN=x', '--', 'node']), /Invalid/);
  assert.throws(() => parseArguments(['run', '--env', `TOKEN=${reference}`, '--', 'node', '{{undeclared}}']), /undeclared/);
  assert.throws(() => parseArguments(['run', '--stdin', reference, '--stdin', reference, '--', 'node']), /one secret/);
  assert.throws(() => parseArguments(['run', '--secret', `token=${reference}`, '--', '{{token}}']), /executable/);
});

test('substitution is single-pass, literal, and does not mutate the parent environment', () => {
  const plan = parseArguments(['run', '--env', `TOKEN=${reference}`, '--secret', `token=${reference}`, '--', 'node', 'Bearer {{token}}']);
  const env = { EXISTING: 'value' };
  const injected = inject(plan, [{ reference, value: '{{token}};$(echo bad) $& "' }], env);
  assert.equal(injected.args[0], 'Bearer {{token}};$(echo bad) $& "');
  assert.equal(env.TOKEN, undefined);
  assert.equal(injected.env.EXISTING, 'value');
  assert.throws(() => inject(plan, [], env), /missing/);
});

test('masking handles every byte split, Unicode, encodings, and overlapping values', async () => {
  for (const secret of [value, 'abc', 'abcdef', 'line1\nline2']) {
    const bytes = Buffer.from(`prefix ${secret} suffix`);
    const mask = new SecretMask([value, 'abc', 'abcdef', 'line1\nline2']);
    const out = output(); mask.pipe(out.stream);
    for (const byte of bytes) mask.write(Buffer.from([byte]));
    mask.end(); await finished(mask);
    assert.equal(out.text(), 'prefix [redacted] suffix');
  }
  const mask = new SecretMask([value]); const out = output(); mask.pipe(out.stream);
  mask.end(`${encodeURIComponent(value)} ${Buffer.from(value).toString('base64')}`);
  await finished(mask); assert.equal(out.text(), '[redacted] [redacted]');
});

test('real child receives environment, argument, and stdin values; output is masked and exit code preserved', async () => {
  const script = `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{if(s!==process.env.TOKEN||s!==process.argv[1])process.exit(2);process.stdout.write(s.slice(0,5));setTimeout(()=>{process.stdout.write(s.slice(5));process.stderr.write(s);process.exitCode=7},20)});`;
  const plan = parseArguments(['run', '--env', `TOKEN=${reference}`, '--secret', `token=${reference}`, '--stdin', reference, '--', process.execPath, '-e', script, '{{token}}']);
  const out = output(); const err = output();
  const code = await execute(plan, inject(plan, [{ reference, value }], process.env), { stdout: out.stream, stderr: err.stream });
  assert.equal(code, 7); assert.equal(out.text(), '[redacted]'); assert.equal(err.text(), '[redacted]');
});

test('resolver failure prevents child execution and unexpected errors are payload-free', async () => {
  const out = output(); const err = output();
  const code = await main(['run', '--env', `TOKEN=${reference}`, '--', process.execPath, '-e', 'console.log("CHILD_RAN")'], { stdout: out.stream, stderr: err.stream, resolver: async () => { throw new Error(value); } });
  assert.equal(code, 1); assert.equal(out.text(), ''); assert.ok(!err.text().includes(value));
});

test('missing executable has a useful exit code without expanded argument diagnostics', async () => {
  const plan = parseArguments(['run', '--secret', `token=${reference}`, '--', 'rtxexec-nonexistent-2120', '{{token}}']);
  const out = output(); const err = output();
  assert.equal(await execute(plan, inject(plan, [{ reference, value }], process.env), { stdout: out.stream, stderr: err.stream }), 127);
  assert.ok(!err.text().includes(value));
});

test('server selection stays local and preserves the runtime path prefix', () => {
  assert.equal(resolveEndpoint({ REALTIMEX_BASE_URL: 'http://localhost:1234/api/cli' }).pathname, '/api/cli/secrets/resolve');
  assert.equal(resolveEndpoint({ SERVER_URL: 'http://127.0.0.1:1234' }).pathname, '/cli/secrets/resolve');
  assert.throws(() => resolveEndpoint({ REALTIMEX_BASE_URL: 'https://example.com/cli' }), /local/);
  assert.throws(() => resolveEndpoint({}), /missing/);
});

test('resolution authenticates with session token and never submits workspace or expanded arguments', async () => {
  let captured;
  const plan = parseArguments(['run', '--env', `TOKEN=${reference}`, '--', 'curl', 'https://example.com']);
  const values = await resolveSecrets(plan, { REALTIMEX_BASE_URL: 'http://localhost:1234/cli', REALTIMEX_TERMINAL_SESSION_TOKEN: 'fixture-session', RTX_WORKSPACE_SLUG: 'spoofed' }, async (url, options) => {
    captured = options;
    return new Response(JSON.stringify({ success: true, secrets: [{ reference, value }] }));
  });
  assert.deepEqual(JSON.parse(captured.body), { references: [reference], executable: 'curl' });
  assert.equal(captured.headers.Authorization, 'RealtimeX-Terminal fixture-session');
  assert.equal(captured.redirect, 'error');
  assert.deepEqual(values, [{ reference, value }]);
});

test('upstream error text never becomes CLI output', async () => {
  const plan = parseArguments(['run', '--stdin', reference, '--', 'curl']);
  await assert.rejects(resolveSecrets(plan, { REALTIMEX_BASE_URL: 'http://localhost:1234/cli', REALTIMEX_TERMINAL_SESSION_TOKEN: 'fixture-session' }, async () => new Response(JSON.stringify({ error: value }), { status: 500 })), (error) => !error.message.includes(value));
});

test('real HTTP transport rejects redirects before starting the command', async () => {
  const server = createServer((req, res) => { res.writeHead(302, { Location: 'http://example.com' }); res.end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const plan = parseArguments(['run', '--stdin', reference, '--', 'curl']);
    await assert.rejects(resolveSecrets(plan, { REALTIMEX_BASE_URL: `http://127.0.0.1:${server.address().port}/cli`, REALTIMEX_TERMINAL_SESSION_TOKEN: 'fixture-session' }), /Could not reach/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('POSIX termination is forwarded to the child group', { skip: process.platform === 'win32', timeout: 5000 }, async () => {
  const { EventEmitter } = await import('node:events');
  const signalSource = new EventEmitter(); const out = new PassThrough(); out.resume();
  const plan = parseArguments(['run', '--env', `TOKEN=${reference}`, '--', process.execPath, '-e', 'process.stdout.write("READY");setInterval(()=>{},1000)']);
  const execution = execute(plan, inject(plan, [{ reference, value }], process.env), { stdout: out, stderr: output().stream, signalSource });
  await once(out, 'data'); signalSource.emit('SIGTERM');
  assert.equal(await execution, 143);
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
});

// The withdrawn 0.4.0 managed email command (realtimex-ai-app#2437). The literal is the contract.
const himalayaDeprecated = '{"ok":false,"code":"RTXEXEC_HIMALAYA_DEPRECATED","message":"Run himalaya directly with keyring/auth-command credentials, or use generic rtxexec --env/--stdin secret:// bindings with a compatible consumer; see the rtxexec README."}\n';
const marker = 'marker-2437-never-echoed';
const himalayaInvocations = [
  ['himalaya'],
  ['himalaya', '--help'],
  ['himalaya', '--plugin', `plugin-${marker}`, '--account', `work-${marker}`, '--binding', `binding-${marker}`, '--operation', 'folders'],
  ['himalaya', '--plugin', `plugin-${marker}`, '--account', 'work', '--operation', 'envelopes', '--folder', 'INBOX', '--page', '1', '--page-size', '200', '--query', `subject ${marker}`],
  ['himalaya', '--plugin', `plugin-${marker}`, '--account', 'work', '--operation', 'move', '--from', 'INBOX', '--to', 'Archive', '--uids', '1,2'],
  ['himalaya', '--operation', `delete-${marker}`, '--config', `/tmp/${marker}.toml`, '--password', marker],
  ['himalaya', '--env', `TOKEN=secret://${marker}`, '--', process.execPath, '-e', 'process.exit(0)'],
];

async function countingHost() {
  const requests = [];
  const server = createServer((req, res) => { requests.push(req.url); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, secrets: [] })); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { requests, env: { REALTIMEX_BASE_URL: `http://127.0.0.1:${server.address().port}/cli`, REALTIMEX_TERMINAL_SESSION_TOKEN: `session-${marker}` },
    close: () => new Promise((resolve) => server.close(resolve)) };
}

test('the withdrawn himalaya command returns one fixed result without parsing, resolving, or contacting the host', async () => {
  const host = await countingHost();
  try {
    for (const argv of himalayaInvocations) {
      for (const env of [{}, host.env, { ...process.env, ...host.env }]) {
        const out = output(); const err = output(); let resolved = 0;
        assert.equal(await main(argv, { env, stdout: out.stream, stderr: err.stream, resolver: async () => { resolved += 1; return []; } }), 1);
        assert.equal(out.text(), himalayaDeprecated); assert.equal(err.text(), ''); assert.equal(resolved, 0);
        const real = output(); const realErr = output();
        assert.equal(await main(argv, { env, stdout: real.stream, stderr: realErr.stream }), 1);
        assert.equal(real.text(), himalayaDeprecated); assert.equal(realErr.text(), '');
      }
    }
    assert.ok(!himalayaDeprecated.includes(marker));
    assert.deepEqual(host.requests, []);
  } finally { await host.close(); }
});

test('the installed bin reports the withdrawal without contacting the host or launching himalaya', { timeout: 20000 }, async () => {
  const host = await countingHost();
  const root = await mkdtemp(path.join(tmpdir(), 'rtxexec-himalaya-'));
  const launched = path.join(root, 'launched');
  try {
    // A himalaya on PATH that records any launch (POSIX: Windows spawn needs a native executable).
    if (process.platform !== 'win32') {
      await writeFile(path.join(root, 'himalaya'), `#!/bin/sh\necho ran > '${launched}'\n`);
      await chmod(path.join(root, 'himalaya'), 0o755);
    }
    const bin = fileURLToPath(new URL('../bin/rtxexec.js', import.meta.url));
    for (const argv of himalayaInvocations) {
      const child = spawn(process.execPath, [bin, ...argv], { env: { ...process.env, ...host.env, PATH: `${root}${path.delimiter}${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
      const [code] = await once(child, 'close');
      assert.equal(code, 1); assert.equal(stdout, himalayaDeprecated); assert.equal(stderr, '');
    }
    assert.deepEqual(host.requests, []); assert.equal(existsSync(launched), false);
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});

test('generic execution still treats himalaya as an ordinary executable or argument', async () => {
  let plan;
  const out = output(); const err = output();
  assert.equal(await main(['--env', `TOKEN=${reference}`, '--', 'himalaya', '--version'], { stdout: out.stream, stderr: err.stream, resolver: async (request) => { plan = request; throw new Error(value); } }), 1);
  assert.equal(plan.command, 'himalaya'); assert.deepEqual(plan.args, ['--version']);
  assert.equal(out.text(), ''); assert.ok(!err.text().includes('HIMALAYA') && !err.text().includes(value));

  const child = output();
  assert.equal(await main(['run', '--stdin', reference, '--', process.execPath, '-e', 'process.stdout.write(process.argv.slice(1).join(" "))', 'himalaya', '--operation', 'folders'],
    { stdout: child.stream, stderr: output().stream, resolver: async () => [{ reference, value }] }), 0);
  assert.equal(child.text(), 'himalaya --operation folders');

  const usage = output(); const usageErr = output();
  assert.equal(await main(['run', 'himalaya', '--operation', 'folders'], { stdout: usage.stream, stderr: usageErr.stream, resolver: async () => { throw new Error('resolved'); } }), 1);
  assert.equal(usage.text(), ''); assert.match(usageErr.text(), /^rtxexec: Use rtxexec \[bindings\]/);
});

test('help no longer advertises managed email and the package exposes no module entry points', async () => {
  const out = output();
  assert.equal(await main(['--help'], { stdout: out.stream, stderr: output().stream }), 0);
  assert.match(out.text(), /^rtxexec — run commands/); assert.doesNotMatch(out.text(), /himalaya|email/i);
  for (const specifier of ['@realtimex/rtxexec', '@realtimex/rtxexec/himalaya/runner', '@realtimex/rtxexec/himalaya/password', '@realtimex/rtxexec/src/cli.js']) {
    await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  }
  assert.equal(existsSync(new URL('../src/himalaya', import.meta.url)), false);
});
