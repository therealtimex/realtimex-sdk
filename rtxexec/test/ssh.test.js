import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSshArguments, runSsh, fillDestination, readCredential, parseOpenSshVersion, supportsAskpassRequire, writeAskpassHelpers, PASSWORD_PROMPT, NO_JUMP_OPTIONS, scanSshArguments } from '../src/ssh.js';
import { execute } from '../src/cli.js';
import { resolveSecrets } from '../src/client.js';

const run = promisify(execFile);

const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-only\n-----END OPENSSH PRIVATE KEY-----\n';
test('SSH use scopes temporary material to the child lifetime and cleans failures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rtxexec-test-'));
  const env = { ORIGINAL: 'preserved' };
  try {
    for (const fail of [false, true]) {
      const plan = parseSshArguments(['ssh', 'secret://deploy', '--', 'ssh', 'user@host']);
      const pending = runSsh(plan, env, async (passedPlan, injected) => {
        assert.equal(passedPlan.command, 'ssh'); assert.equal(injected.args.at(-1), 'user@host');
        const keyPath = injected.args[1];
        assert.equal(await readFile(keyPath, 'utf8'), privateKey);
        if (process.platform !== 'win32') assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
        assert.deepEqual(injected.values, [privateKey]); assert.equal(injected.env.ORIGINAL, 'preserved');
        if (fail) throw new Error('child failed');
        return 7;
      }, { root, resolver: async request => { assert.equal(request.ssh, true); return [{ privateKey }]; } });
      if (fail) await assert.rejects(pending, /child failed/); else assert.equal(await pending, 7);
      assert.deepEqual(await readdir(root), []);
    }
    assert.deepEqual(env, { ORIGINAL: 'preserved' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('Git receives only a quoted temporary path; other executables are rejected', async () => {
  assert.throws(() => parseSshArguments(['ssh', 'secret://x', '--', 'cat']));
  assert.throws(() => parseSshArguments(['ssh', 'secret://x#privateKey', '--', 'ssh']));
  const plan = parseSshArguments(['ssh', 'secret://deploy', '--', 'git', 'fetch']);
  await runSsh(plan, {}, async (_, injected) => {
    assert.deepEqual(injected.args, ['fetch']); assert.equal(injected.env.GIT_SSH_VARIANT, 'ssh');
    assert.ok(injected.env.GIT_SSH_COMMAND.includes('IdentitiesOnly=yes'));
    assert.ok(!injected.env.GIT_SSH_COMMAND.includes(privateKey));
    return 0;
  }, { resolver: async () => [{ privateKey }] });
});

const password = 'pa ss\'"$(no)`w0rd-α';
const v96 = async () => 'OpenSSH_9.6p1, OpenSSL 3.0.13 30 Jan 2024';
const fill = (args, stored) => fillDestination(args, { host: 'box.example', port: '2222', username: 'DOMAIN\\ops@corp', ...stored });

test('stored destination fill follows the OpenSSH option grammar', () => {
  const u = ['-l', 'DOMAIN\\ops@corp'];
  // No positional: add the saved destination.
  assert.deepEqual(fill([]), ['-p', '2222', ...u, 'box.example']);
  assert.deepEqual(fill(['-v', '-i', 'mykey']), ['-p', '2222', ...u, '-v', '-i', 'mykey', 'box.example']);
  assert.deepEqual(fill(['-v', '--']), ['-p', '2222', ...u, '-v', '--', 'box.example']);
  assert.deepEqual(fill([], { port: undefined, username: undefined }), ['box.example']);
  // Value options consume the next argument, or an attached value, even when bundled.
  assert.deepEqual(fill(['-o', 'ConnectTimeout=5', '-J', 'jump']), ['-p', '2222', ...u, '-o', 'ConnectTimeout=5', '-J', 'jump', 'box.example']);
  assert.deepEqual(fill(['-vF', 'cfg']), ['-p', '2222', ...u, '-vF', 'cfg', 'box.example']);
  assert.deepEqual(fill(['-Fcfg', '-Q', 'cipher']), ['-p', '2222', ...u, '-Fcfg', '-Q', 'cipher', 'box.example']);
  // The user's port and user win, in every spelling.
  for (const own of [['-p', '22'], ['-p22'], ['-vp', '22'], ['-o', 'Port=22'], ['-o', 'port 22'], ['-oPort=22']]) assert.deepEqual(fill(own), [...u, ...own, 'box.example']);
  for (const own of [['-l', 'me'], ['-lme'], ['-o', 'User=me'], ['-oUSER me']]) assert.deepEqual(fill(own), ['-p', '2222', ...own, 'box.example']);
  assert.deepEqual(fill(['-o', 'UserKnownHostsFile=/k']), ['-p', '2222', ...u, '-o', 'UserKnownHostsFile=/k', 'box.example']);
  // {{target}} becomes the saved host; options after the destination still count, like ssh.
  assert.deepEqual(fill(['{{target}}', 'uptime']), ['-p', '2222', ...u, 'box.example', 'uptime']);
  assert.deepEqual(fill(['-v', '{{target}}', '-p', '22', 'uptime', '-l', 'x']), [...u, '-v', 'box.example', '-p', '22', 'uptime', '-l', 'x']);
  assert.deepEqual(fill(['--', '{{target}}', 'uptime']), ['-p', '2222', ...u, '--', 'box.example', 'uptime']);
  assert.deepEqual(fill(['-p', '{{target}}']), [...u, '-p', '{{target}}', 'box.example']);
  // Any other destination wins and nothing is added.
  for (const args of [['user@other'], ['other', 'uptime'], ['-p', '22', 'other'], ['--', 'other'], ['root@{{target}}'], ['-'], ['other', '{{target}}']]) assert.deepEqual(fill(args), args);
  // No saved host: pass through, except {{target}}.
  assert.deepEqual(fillDestination(['-v'], {}), ['-v']);
  assert.throws(() => fillDestination(['{{target}}'], { username: 'u' }), /\{\{target\}\} needs an SSH login with a saved host/);
});

test('the resolve response is validated; key-only responses from older apps still work', () => {
  assert.deepEqual(readCredential({ reference: 'secret://x', privateKey }), { privateKey, password: undefined, username: undefined, host: undefined, port: undefined });
  assert.deepEqual(readCredential({ password, host: '[2001:db8::1]', port: 22, username: 'a@b' }), { privateKey: undefined, password, username: 'a@b', host: '2001:db8::1', port: '22' });
  assert.throws(() => readCredential({}), /key or password/);
  assert.throws(() => readCredential({ privateKey: 'not a key', password }), /usable SSH key/);
  assert.throws(() => readCredential({ password: 'a\nb' }), /usable SSH password/);
  for (const host of ['-oProxyCommand=x', 'a b', 'u@h', '[]', 'x'.repeat(254)]) assert.throws(() => readCredential({ password, host }), /SSH host/);
  for (const port of ['0', '65536', '22x', '-1']) assert.throws(() => readCredential({ password, port }), /SSH port/);
  for (const username of ['-x', 'a b', 'a\tb']) assert.throws(() => readCredential({ password, username }), /SSH username/);
});

test('OpenSSH versions are parsed and gated at 8.4', () => {
  assert.deepEqual(parseOpenSshVersion('OpenSSH_9.6p1, OpenSSL 3.0.13'), [9, 6]);
  assert.deepEqual(parseOpenSshVersion('OpenSSH_for_Windows_8.1p1, LibreSSL 3.0.2'), [8, 1]);
  assert.deepEqual(parseOpenSshVersion('OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2'), [9, 5]);
  assert.deepEqual(parseOpenSshVersion('OpenSSH_10.0p2'), [10, 0]);
  assert.equal(parseOpenSshVersion('ssh: command not found'), null);
  assert.equal(supportsAskpassRequire([8, 4]), true);
  assert.equal(supportsAskpassRequire([10, 0]), true);
  assert.equal(supportsAskpassRequire([8, 3]), false);
  assert.equal(supportsAskpassRequire([7, 9]), false);
  assert.equal(supportsAskpassRequire(null), false);
});

test('password sign-in fails closed on old OpenSSH before writing files; key-only has no gate', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rtxexec-test-'));
  try {
    for (const version of ['OpenSSH_for_Windows_8.1p1', 'OpenSSH_8.3p1', '']) {
      let launched = false; let probed;
      await assert.rejects(runSsh(parseSshArguments(['ssh', 'secret://box', '--', '/usr/bin/ssh']), {}, async () => { launched = true; }, {
        root, resolver: async () => [{ privateKey, password }], sshVersion: async command => { probed = command; return version; },
      }), /SSH password sign-in needs OpenSSH 8.4 or later/);
      assert.equal(launched, false); assert.equal(probed, '/usr/bin/ssh');
      assert.deepEqual(await readdir(root), []);
    }
    let probedGit;
    await assert.rejects(runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'git', 'fetch']), {}, async () => 0, {
      root, resolver: async () => [{ password }], sshVersion: async command => { probedGit = command; return 'OpenSSH_7.4p1'; },
    }), /8\.4/);
    assert.equal(probedGit, 'ssh');
    assert.equal(await runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'ssh', 'h']), {}, async () => 0, {
      root, resolver: async () => [{ privateKey }], sshVersion: async () => { throw new Error('key-only must not probe'); },
    }), 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ssh options for key only, password only, and both', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rtxexec-test-'));
  try {
    const cases = [
      [{ privateKey }, ['-i', 'IDENTITY', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none']],
      [{ password }, [...NO_JUMP_OPTIONS, '-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=keyboard-interactive,password', '-o', 'NumberOfPasswordPrompts=1']],
      [{ privateKey, password }, [...NO_JUMP_OPTIONS, '-i', 'IDENTITY', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'PreferredAuthentications=publickey,keyboard-interactive,password', '-o', 'NumberOfPasswordPrompts=1']],
    ];
    for (const [credential, expected] of cases) {
      await runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'ssh', '{{target}}', 'uptime']), { KEEP: '1' }, async (_, injected) => {
        const dir = path.dirname(credential.privateKey ? injected.args[injected.args.indexOf('-i') + 1] : injected.env.SSH_ASKPASS);
        assert.deepEqual(injected.args.map(arg => arg === path.join(dir, 'identity') ? 'IDENTITY' : arg), [...expected, '-l', 'ops', 'box', 'uptime']);
        assert.ok(!injected.args.some(arg => /BatchMode/i.test(arg)));
        assert.deepEqual(injected.values, [credential.privateKey, credential.password].filter(Boolean));
        assert.equal(injected.env.KEEP, '1');
        // The password is never in argv or the child environment.
        assert.ok(!injected.args.some(arg => arg.includes(password)));
        assert.ok(!Object.values(injected.env).some(value => String(value).includes(password)));
        if (credential.password) {
          assert.equal(injected.env.SSH_ASKPASS_REQUIRE, 'force');
          assert.equal(await readFile(path.join(dir, 'password'), 'utf8'), password);
          assert.ok(!(await readFile(injected.env.SSH_ASKPASS, 'utf8')).includes(password));
          if (process.platform !== 'win32') {
            assert.equal((await stat(path.join(dir, 'password'))).mode & 0o777, 0o600);
            assert.equal((await stat(injected.env.SSH_ASKPASS)).mode & 0o777, 0o700);
          }
        } else assert.equal(injected.env.SSH_ASKPASS, undefined);
        assert.equal(injected.env.GIT_ASKPASS, undefined);
        return 0;
      }, { root, resolver: async () => [{ ...credential, username: 'ops', host: 'box' }], sshVersion: v96 });
      assert.deepEqual(await readdir(root), []);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('git gets the same options, a deny-all GIT_ASKPASS, and no stored destination', async () => {
  await runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'git', 'fetch', 'origin']), {}, async (_, injected) => {
    assert.deepEqual(injected.args, ['fetch', 'origin']);
    for (const option of ['ProxyJump=none', 'ProxyCommand=none', 'PermitLocalCommand=no', 'PubkeyAuthentication=no', 'PreferredAuthentications=keyboard-interactive,password', 'NumberOfPasswordPrompts=1']) assert.ok(injected.env.GIT_SSH_COMMAND.includes(option));
    assert.ok(!injected.env.GIT_SSH_COMMAND.includes('box.example') && !injected.env.GIT_SSH_COMMAND.includes('-p'));
    assert.ok(!injected.env.GIT_SSH_COMMAND.includes(password));
    assert.equal(injected.env.SSH_ASKPASS_REQUIRE, 'force');
    assert.notEqual(injected.env.GIT_ASKPASS, injected.env.SSH_ASKPASS);
    if (process.platform !== 'win32') {
      const denied = await run(injected.env.GIT_ASKPASS, ["Password for 'https://user@example.com': "]).then(() => 0, error => error.code);
      assert.equal(denied, 1);
    }
    return 0;
  }, { resolver: async () => [{ password, privateKey: undefined, host: 'box.example', port: '2222', username: 'ops' }], sshVersion: v96 });
  // Both credentials together on git as well.
  await runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'git', 'fetch']), {}, async (_, injected) => {
    for (const option of ['ProxyJump=none', 'ProxyCommand=none', 'PermitLocalCommand=no', 'IdentitiesOnly=yes', 'IdentityAgent=none', 'PreferredAuthentications=publickey,keyboard-interactive,password']) assert.ok(injected.env.GIT_SSH_COMMAND.includes(option));
    assert.ok(injected.env.GIT_ASKPASS);
    return 0;
  }, { resolver: async () => [{ password, privateKey }], sshVersion: v96 });
});

const prompts = [
  ["user@host's password: ", true],
  ['(user@host) Password: ', true],
  ['(DOMAIN\\ops@10.0.0.5) Password:', true],
  ['Password:', true],
  ['Enter PASSWORD for ops: ', true],
  ["The authenticity of host 'h (1.2.3.4)' can't be established.\nED25519 key fingerprint is SHA256:abc.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ", false],
  ["Warning: password: changed\nAre you sure you want to continue connecting (yes/no)? ", false],
  ['(user@host) Verification code: ', false],
  ["Enter passphrase for key '/k': ", false],
  ['passwordless: yes', false],
  ['Old password hint: ', true],
  ['Old-password-hint: ', false],
  ['mypassword: ', false],
  ['', false],
];

test('the generated POSIX askpass helper answers password prompts only', { skip: process.platform === 'win32' }, async () => {
  await runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'ssh', 'h']), {}, async (_, injected) => {
    for (const [prompt, expected] of prompts) {
      assert.equal(PASSWORD_PROMPT.test(prompt), expected, prompt);
      const result = await run(injected.env.SSH_ASKPASS, [prompt]).then(({ stdout }) => ({ code: 0, stdout }), error => ({ code: error.code, stdout: error.stdout }));
      assert.deepEqual(result, expected ? { code: 0, stdout: password } : { code: 1, stdout: '' }, prompt);
    }
    return 0;
  }, { resolver: async () => [{ password }], sshVersion: v96 });
});

test('the Windows askpass helper never contains the password and matches like the POSIX one', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rtxexec-test-'));
  try {
    const passwordPath = path.join(dir, 'password');
    await writeFile(passwordPath, password);
    const helpers = await writeAskpassHelpers(dir, passwordPath, 'win32');
    assert.equal(path.basename(helpers.askpass), 'askpass.cmd');
    assert.equal(path.basename(helpers.deny), 'deny-askpass.cmd');
    for (const file of await readdir(dir)) if (file !== 'password') assert.ok(!(await readFile(path.join(dir, file), 'utf8')).includes(password), file);
    assert.match(await readFile(helpers.deny, 'utf8'), /exit \/b 1/);
    const script = path.join(dir, 'askpass.cjs');
    for (const [prompt, expected] of prompts) {
      const result = await run(process.execPath, [script, prompt]).then(({ stdout }) => ({ code: 0, stdout }), error => ({ code: error.code, stdout: error.stdout }));
      assert.deepEqual(result, expected ? { code: 0, stdout: password } : { code: 1, stdout: '' }, prompt);
    }
    if (process.platform === 'win32') {
      const viaCmd = await run('cmd.exe', ['/d', '/c', helpers.askpass, "user@host's password: "]).then(({ stdout }) => stdout);
      assert.equal(viaCmd, password);
      assert.equal(await run('cmd.exe', ['/d', '/c', helpers.askpass, 'Are you sure (yes/no)? ']).then(() => 0, error => error.code), 1);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the temporary directory is removed after a forwarded signal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rtxexec-test-'));
  try {
    const signals = new EventEmitter();
    const code = await runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'ssh']), {}, async (plan, injected) => {
      assert.equal((await readdir(root)).length, 1);
      // Stand in for ssh with a long-running child; the real execute forwards the signal.
      const child = { ...plan, command: process.execPath };
      const pending = execute(child, { ...injected, args: ['-e', 'process.stdout.write("up"); setTimeout(() => {}, 60000)'] }, { stdout: new PassThrough(), stderr: new PassThrough(), signalSource: signals });
      await new Promise(resolve => setTimeout(resolve, 300));
      signals.emit('SIGTERM');
      return pending;
    }, { root, resolver: async () => [{ privateKey, password, host: 'h' }], sshVersion: v96 });
    assert.notEqual(code, 0);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the client asks for the SSH login fields and maps the new refusals', async () => {
  const env = { REALTIMEX_BASE_URL: 'http://localhost:1234/cli', REALTIMEX_TERMINAL_SESSION_TOKEN: 'fixture-session' };
  const plan = parseSshArguments(['ssh', 'secret://box', '--', 'ssh']);
  let body;
  await resolveSecrets(plan, env, async (_, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({ success: true, secrets: [{ reference: 'secret://box', password }] })); });
  assert.deepEqual(body, { references: ['secret://box'], executable: 'ssh', ssh: true, sshLogin: 1 });
  for (const [code, message] of [['SECRET_SSH_LOGIN_EMPTY', /private key or password/], ['SECRET_SSH_CLIENT_OUTDATED', /Update rtxexec/], ['SECRET_FIELD_REQUIRED', /#password/]]) {
    await assert.rejects(resolveSecrets(plan, env, async () => new Response(JSON.stringify({ success: false, code }), { status: 422 })), message);
  }
});

test('a bracketed host is unwrapped only for a real IPv6 literal (Review P1-1)', async () => {
  for (const [host, expected] of [['[2001:db8::1]', '2001:db8::1'], ['[::1]', '::1'], ['[fe80::1%en0]', 'fe80::1%en0'], ['[::ffff:192.0.2.1]', '::ffff:192.0.2.1'], ['2001:db8::1', '2001:db8::1']]) {
    assert.equal(readCredential({ password, host }).host, expected, host);
  }
  const bad = ['[-oProxyCommand=review-fixture]', '[-p]', '[box.example]', '[1.2.3.4]', '[::1', '::1]', '[::1%en0 x]', '[::1%-x;y]', '[]', '[:: 1]'];
  for (const host of bad) assert.throws(() => readCredential({ password, host }), /SSH host/, host);
  for (const host of bad) assert.throws(() => readCredential({ privateKey, host }), /SSH host/, host);
  // End to end: nothing launches for any of the shapes Review named.
  for (const args of [['{{target}}', 'uptime'], [], ['{{target}}'], ['-v']]) {
    let launched = false;
    await assert.rejects(runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'ssh', ...args]), {}, async () => { launched = true; return 0; }, {
      resolver: async () => [{ privateKey, host: '[-oProxyCommand=review-fixture]' }], sshVersion: v96,
    }), /SSH host/);
    assert.equal(launched, false);
  }
});

const jumpForms = [['-J', 'bastion'], ['-Jbastion'], ['-vJ', 'bastion'], ['-o', 'ProxyJump=bastion'], ['-oProxyJump=bastion'], ['-o', 'proxyjump bastion'],
  ['-o', 'PROXYJUMP = bastion'], ['-o', 'ProxyCommand=nc %h %p'], ['-oproxycommand ssh -W %h:%p bastion'], ['-o', 'ProxyCommand\tnc bastion 22']];

test('the jump parser finds every spelling, and none is not a jump', () => {
  for (const form of jumpForms) {
    assert.equal(scanSshArguments([...form, 'host']).jump, true, form.join(' '));
    assert.equal(scanSshArguments(['host', ...form, 'uptime']).jump, true, `after destination: ${form.join(' ')}`);
  }
  for (const args of [['-o', 'ProxyJump=none', 'h'], ['-oProxyCommand none', 'h'], ['-o', 'ProxyJumpX=1', 'h'], ['h', 'echo', '-J', 'x'], ['-F', 'cfg', 'h'], ['--', '-J', 'x']]) {
    assert.equal(scanSshArguments(args).jump, false, args.join(' '));
  }
});

test('a password item refuses a jump before anything is written; key-only jumps pass through (A4)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rtxexec-test-'));
  try {
    for (const credential of [{ password }, { privateKey, password }]) {
      for (const form of jumpForms) {
        let launched = false;
        await assert.rejects(runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'ssh', ...form, '{{target}}', 'uptime']), {}, async () => { launched = true; return 0; }, {
          root, resolver: async () => [{ ...credential, host: 'box' }], sshVersion: v96,
        }), /Password sign-in can't go through a jump host\. Use a key, or connect without -J\/ProxyJump\./);
        assert.equal(launched, false);
        assert.deepEqual(await readdir(root), []);
      }
    }
    // Key-only: no injected jump options, and the user's jump goes to ssh unchanged.
    await runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'ssh', '-J', 'bastion', 'box']), {}, async (_, injected) => {
      assert.deepEqual(injected.args.slice(-3), ['-J', 'bastion', 'box']);
      assert.ok(!injected.args.some(arg => /ProxyJump|ProxyCommand|PermitLocalCommand/.test(arg)));
      assert.equal(injected.env.SSH_ASKPASS, undefined);
      return 0;
    }, { root, resolver: async () => [{ privateKey, host: 'other' }] });
    // The direct target still works with a password.
    await runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'ssh', '{{target}}', 'uptime']), {}, async (_, injected) => {
      assert.deepEqual(injected.args.slice(-2), ['box', 'uptime']);
      assert.deepEqual(injected.args.slice(0, 6), NO_JUMP_OPTIONS);
      return 0;
    }, { root, resolver: async () => [{ password, host: 'box' }], sshVersion: v96 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

const sshOnPath = await run('ssh', ['-V']).then(() => true, () => false);
test('ssh -G: the injected options turn off a jump from a -F config (Review repro)', { skip: !sshOnPath && 'ssh not on PATH' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rtxexec-test-'));
  try {
    const config = path.join(dir, 'config');
    await writeFile(config, 'Host *\n  ProxyJump bastion.example\n  PermitLocalCommand yes\n  LocalCommand echo leak\n');
    const commandConfig = path.join(dir, 'config2');
    await writeFile(commandConfig, 'Host *\n  ProxyCommand ssh -W %h:%p bastion.example\n');
    const resolved = async args => Object.fromEntries((await run('ssh', ['-G', ...args, 'box.example'])).stdout.split(/\r?\n/).map(line => line.split(' ')).map(([k, ...v]) => [k.toLowerCase(), v.join(' ')]));
    // Control: without rtxexec's options the jump is active.
    assert.equal((await resolved(['-F', config])).proxyjump, 'bastion.example');
    assert.equal((await resolved(['-F', commandConfig])).proxycommand, 'ssh -W %h:%p bastion.example');
    // With them (first value wins), no jump or proxy command survives and LocalCommand is off.
    for (const file of [config, commandConfig]) {
      const options = await resolved([...NO_JUMP_OPTIONS, '-F', file]);
      assert.ok(options.proxyjump === undefined || options.proxyjump === 'none', JSON.stringify(options.proxyjump));
      assert.ok(options.proxycommand === undefined || options.proxycommand === 'none', JSON.stringify(options.proxycommand));
      assert.equal(options.permitlocalcommand, 'no');
    }
    // The same through the full runSsh path: the jump never gets the target password.
    await runSsh(parseSshArguments(['ssh', 'secret://box', '--', 'ssh', '-F', config, '{{target}}']), {}, async (_, injected) => {
      const args = injected.args.filter((arg, i, all) => arg !== 'box.example' || i !== all.length - 1);
      const options = await resolved(args);
      assert.ok(options.proxyjump === undefined || options.proxyjump === 'none');
      assert.equal(options.permitlocalcommand, 'no');
      return 0;
    }, { resolver: async () => [{ password, host: 'box.example' }], sshVersion: v96 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
