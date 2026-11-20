import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { UsageError } from './error.js';
import { resolveSecrets } from './client.js';

const run = promisify(execFile);
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
const KEY_HEADER = '-----BEGIN OPENSSH PRIVATE KEY-----';
const MAX_SECRET = 65536;
// OpenSSH's getopt string: these options consume a value (attached or the next argument).
const VALUE_OPTIONS = new Set('BbcDEeFIiJLlmOoPpQRSWw');
const TARGET = '{{target}}';
// A leading "-" would turn the host into an ssh option.
const SAFE_HOST = /^(?!-)[^\s@\0-\x1f\x7f]{1,253}$/;
// A jump's ssh inherits SSH_ASKPASS, so with a password no jump may run (A4).
// OpenSSH keeps the first value it gets, so these beat -F files and the config.
export const NO_JUMP_OPTIONS = ['-o', 'ProxyJump=none', '-o', 'ProxyCommand=none', '-o', 'PermitLocalCommand=no'];
const JUMP_REFUSED = "Password sign-in can't go through a jump host. Use a key, or connect without -J/ProxyJump.";
// Answer only password and keyboard-interactive password prompts, never host-key questions.
export const PASSWORD_PROMPT = /(^|\s|\))password[^:]*:\s*$/i;
export const MIN_OPENSSH = [8, 4];

export function parseSshArguments(argv) {
  if (!argv[1]?.startsWith('secret://') || argv[1].includes('#') || argv[2] !== '--' || !argv[3]) throw new UsageError('Use rtxexec ssh secret://name -- ssh|git [arguments].');
  const name = path.win32.basename(path.basename(argv[3])).replace(/\.exe$/i, '').toLowerCase();
  if (!['ssh', 'git'].includes(name)) throw new UsageError('SSH execution supports ssh and git.');
  return { references: [argv[1]], command: argv[3], args: argv.slice(4), ssh: true, sshCommand: name };
}

export function parseOpenSshVersion(text) {
  const match = /OpenSSH_(?:for_Windows_)?(\d+)\.(\d+)/.exec(String(text ?? ''));
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function supportsAskpassRequire(version) {
  return Boolean(version) && (version[0] > MIN_OPENSSH[0] || (version[0] === MIN_OPENSSH[0] && version[1] >= MIN_OPENSSH[1]));
}

async function probeSshVersion(command, env) {
  try {
    const { stdout, stderr } = await run(command, ['-V'], { env, timeout: 10000, windowsHide: true });
    return `${stderr}\n${stdout}`;
  } catch (error) { return `${error?.stderr ?? ''}\n${error?.stdout ?? ''}`; }
}

function optional(value, name, pattern) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !pattern.test(text)) throw new UsageError(`RealTimeX returned an invalid SSH ${name}.`);
  return text;
}

// Validate the resolve response. A key-only response from an older app has no new fields.
export function readCredential(credential) {
  const privateKey = credential?.privateKey || undefined;
  const password = credential?.password || undefined;
  if (privateKey !== undefined && (typeof privateKey !== 'string' || !privateKey.includes(KEY_HEADER) || Buffer.byteLength(privateKey) > MAX_SECRET)) throw new UsageError('RealTimeX did not provide a usable SSH key.');
  if (password !== undefined && (typeof password !== 'string' || /[\0\r\n]/.test(password) || Buffer.byteLength(password) > MAX_SECRET)) throw new UsageError('RealTimeX did not provide a usable SSH password.');
  if (!privateKey && !password) throw new UsageError('RealTimeX did not provide a usable SSH key or password.');
  // A leading "-" would turn a stored value into an ssh option.
  const username = optional(credential.username, 'username', /^(?!-)[^\s\0-\x1f\x7f]{1,256}$/);
  let host = optional(credential.host, 'host', /^[^\s@\0-\x1f\x7f]{1,253}$/);
  if (host?.startsWith('[') || host?.endsWith(']')) {
    // ssh takes IPv6 literals without brackets. Unwrap only a real IPv6 literal.
    const literal = /^\[([0-9A-Fa-f.]*:[0-9A-Fa-f:.]*(?:%[A-Za-z0-9._-]+)?)\]$/.exec(host);
    if (!literal) throw new UsageError('RealTimeX returned an invalid SSH host.');
    host = literal[1];
  }
  if (host !== undefined && !SAFE_HOST.test(host)) throw new UsageError('RealTimeX returned an invalid SSH host.');
  const port = optional(credential.port, 'port', /^\d{1,5}$/);
  if (port && (Number(port) < 1 || Number(port) > 65535)) throw new UsageError('RealTimeX returned an invalid SSH port.');
  return { privateKey, password, username, host, port };
}

const isNone = value => /^\s*none\s*$/i.test(value);

function noteOption(flag, value, found) {
  if (value === undefined) return;
  if (flag === 'p') found.port = true;
  else if (flag === 'l') found.user = true;
  else if (flag === 'J') found.jump ||= !isNone(value);
  else if (flag === 'o') {
    const option = /^\s*(port|user|proxyjump|proxycommand)\s*(?:=|\s)\s*(.*)$/is.exec(value);
    const keyword = option?.[1].toLowerCase();
    if (keyword === 'port' || keyword === 'user') found[keyword] = true;
    else if (keyword) found.jump ||= !isNone(option[2]);
  }
}

function scanOptions(args, start, found) {
  for (let i = start; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') return { index: i + 1 < args.length ? i + 1 : -1, terminated: true };
    if (!arg.startsWith('-') || arg === '-') return { index: i, terminated: false };
    for (let j = 1; j < arg.length; j++) {
      if (!VALUE_OPTIONS.has(arg[j])) continue;
      noteOption(arg[j], j + 1 < arg.length ? arg.slice(j + 1) : args[++i], found);
      break;
    }
  }
  return { index: -1, terminated: false };
}

// Find ssh's destination the way OpenSSH does: options, then the first positional
// (or the argument after "--"). Like ssh, options right after the destination still count.
export function scanSshArguments(args) {
  const found = { port: false, user: false, jump: false };
  const { index, terminated } = scanOptions(args, 0, found);
  if (index >= 0 && !terminated) scanOptions(args, index + 1, found);
  return { index, port: found.port, user: found.user, jump: found.jump };
}

export function fillDestination(args, { host, port, username }) {
  const scan = scanSshArguments(args);
  const target = scan.index >= 0 && args[scan.index] === TARGET;
  if (scan.index >= 0 && !target) return args; // An explicit destination wins.
  if (!host) {
    if (target) throw new UsageError(`${TARGET} needs an SSH login with a saved host.`);
    return args;
  }
  // Options go first, so they stay options even when the arguments end with "--".
  const options = [...(port && !scan.port ? ['-p', port] : []), ...(username && !scan.user ? ['-l', username] : [])];
  if (!target) return [...options, ...args, host];
  const filled = [...args]; filled[scan.index] = host;
  return [...options, ...filled];
}

export function sshOptions({ keyPath, password }) {
  const key = keyPath ? ['-i', keyPath, '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none'] : [];
  if (!password) return key;
  if (!keyPath) return [...NO_JUMP_OPTIONS, '-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=keyboard-interactive,password', '-o', 'NumberOfPasswordPrompts=1'];
  return [...NO_JUMP_OPTIONS, ...key, '-o', 'PreferredAuthentications=publickey,keyboard-interactive,password', '-o', 'NumberOfPasswordPrompts=1'];
}

// The helpers never contain the password; they print the password file for a password prompt only.
export async function writeAskpassHelpers(directory, passwordPath, platform = process.platform) {
  if (platform === 'win32') {
    const script = path.join(directory, 'askpass.cjs');
    await writeFile(script, [
      "'use strict';",
      `if (!${PASSWORD_PROMPT}.test(process.argv[2] || '')) process.exit(1);`,
      `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(passwordPath)}));`,
      '',
    ].join('\n'), { flag: 'wx' });
    const askpass = path.join(directory, 'askpass.cmd');
    await writeFile(askpass, `@echo off\r\n"${process.execPath}" "${script}" %*\r\nexit /b %ERRORLEVEL%\r\n`, { flag: 'wx' });
    const deny = path.join(directory, 'deny-askpass.cmd');
    await writeFile(deny, '@exit /b 1\r\n', { flag: 'wx' });
    return { askpass, deny };
  }
  const askpass = path.join(directory, 'askpass');
  // Same test as PASSWORD_PROMPT; awk's $ is end of string and [^:] spans newlines.
  await writeFile(askpass, [
    '#!/bin/sh',
    "RTXEXEC_PROMPT=\"$1\" LC_ALL=C awk 'BEGIN { p = tolower(ENVIRON[\"RTXEXEC_PROMPT\"]); exit !(p ~ /(^|[ \\t\\n\\r\\f\\v]|\\))password[^:]*:[ \\t\\n\\r\\f\\v]*$/) }' || exit 1",
    `exec cat ${quote(passwordPath)}`,
    '',
  ].join('\n'), { mode: 0o700, flag: 'wx' });
  const deny = path.join(directory, 'deny-askpass');
  await writeFile(deny, '#!/bin/sh\nexit 1\n', { mode: 0o700, flag: 'wx' });
  return { askpass, deny };
}

export async function runSsh(plan, env, execute, { resolver = resolveSecrets, root = tmpdir(), sshVersion = probeSshVersion } = {}) {
  const [response] = await resolver(plan, env);
  const credential = readCredential(response);
  const isSsh = plan.sshCommand === 'ssh';
  // Stored user/host/port fill ssh only; Git takes the destination from the remote URL.
  const args = isSsh ? fillDestination(plan.args, credential) : plan.args;
  if (credential.password) {
    // The app reveals the password only at resolve, so a jump is refused here,
    // before any file is written. A form this misses is still off: NO_JUMP_OPTIONS.
    if (isSsh && scanSshArguments(plan.args).jump) throw new UsageError(JUMP_REFUSED);
    // SSH_ASKPASS_REQUIRE needs OpenSSH 8.4. The app tells rtxexec about a password
    // only when it resolves, so the gate runs here, before any file is written.
    const version = parseOpenSshVersion(await sshVersion(isSsh ? plan.command : 'ssh', env));
    if (!supportsAskpassRequire(version)) throw new UsageError('SSH password sign-in needs OpenSSH 8.4 or later.');
  }
  let directory;
  try {
    directory = await mkdtemp(path.join(root, 'rtxexec-ssh-'));
    if (process.platform === 'win32') {
      // Secure the empty directory before writing material. Fail closed if ACLs
      // cannot be set (e.g. a non-NTFS temp directory).
      await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
    } else await chmod(directory, 0o700);
    let keyPath;
    if (credential.privateKey) {
      keyPath = path.join(directory, 'identity');
      await writeFile(keyPath, credential.privateKey, { mode: 0o600, flag: 'wx' });
    }
    const childEnv = { ...env };
    if (credential.password) {
      const passwordPath = path.join(directory, 'password');
      await writeFile(passwordPath, credential.password, { mode: 0o600, flag: 'wx' });
      const helpers = await writeAskpassHelpers(directory, passwordPath);
      childEnv.SSH_ASKPASS = helpers.askpass;
      childEnv.SSH_ASKPASS_REQUIRE = 'force';
      // Git asks GIT_ASKPASS before SSH_ASKPASS for its own (HTTPS) prompts: refuse them all.
      if (!isSsh) childEnv.GIT_ASKPASS = helpers.deny;
    }
    const options = sshOptions({ keyPath, password: credential.password });
    let childArgs = args;
    if (isSsh) childArgs = [...options, ...args];
    else {
      // Git consumes this command through its own shell. Only generated paths
      // and fixed options are included, with POSIX quoting (also used by Git for Windows).
      childEnv.GIT_SSH_COMMAND = ['ssh', ...options.map(value => process.platform === 'win32' ? value.replace(/\\/g, '/') : value)].map(quote).join(' ');
      childEnv.GIT_SSH_VARIANT = 'ssh';
    }
    return await execute(plan, { args: childArgs, env: childEnv, stdin: undefined, values: [credential.privateKey, credential.password].filter(Boolean) });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
