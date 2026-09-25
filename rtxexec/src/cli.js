import { UsageError } from "./error.js";
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { readFileSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { parseArguments, inject } from './arguments.js';
import { resolveSecrets } from './client.js';
import { SecretMask } from './mask.js';

const help = `rtxexec — run commands using RealTimeX secrets

Usage: rtxexec [bindings] -- executable [arguments]
  --env NAME=secret://name       Inject a child environment variable
  --secret alias=secret://name   Substitute {{alias}} inside argument values
  --stdin secret://name          Write the exact value to child stdin, then close it

Manage secrets with realtimex-pp-cli or Settings > Secrets.
Requires the running app and its terminal-session environment. No secret cache.
Runs executables directly, without a shell. Output is UTF-8 with known values
masked; transformed output, files, network traffic, and child arguments may
expose secrets. Full-screen/TTY applications are not supported. On Windows,
use native executables or node with a script path, rather than .cmd/.bat files.
`;

export async function execute(plan, injected, { stdout = process.stdout, stderr = process.stderr, signalSource = process, spawnImpl = spawn } = {}) {
  const child = spawnImpl(plan.command, injected.args, {
    env: injected.env, shell: false, windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: [injected.stdin === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'],
  });
  const outMask = new SecretMask(injected.values); const errMask = new SecretMask(injected.values);
  child.stdout.pipe(outMask).pipe(stdout, { end: false });
  child.stderr.pipe(errMask).pipe(stderr, { end: false });
  const streams = Promise.all([finished(outMask), finished(errMask)]);
  const forwards = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => [signal, () => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* Child already exited. */ }
  }]));
  for (const [signal, handler] of forwards) signalSource.on(signal, handler);
  try {
    if (injected.stdin !== undefined) {
      child.stdin.on('error', () => {}); // Programs may close stdin before consuming it.
      child.stdin.end(injected.stdin);
    }
    const outcome = await new Promise((resolve) => {
      child.once('error', (error) => resolve({ failed: error.code === 'ENOENT' ? 127 : 126 }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    await streams;
    if (outcome.failed) { stderr.write('rtxexec: could not launch executable. Check its installation and permissions.\n'); return outcome.failed; }
    return outcome.signal ? 128 + (constants.signals[outcome.signal] || 1) : outcome.code ?? 1;
  } finally {
    for (const [signal, handler] of forwards) signalSource.removeListener(signal, handler);
  }
}

export async function main(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr, resolver = resolveSecrets } = {}) {
  try {
    const plan = parseArguments(argv);
    if (plan.help) { stdout.write(help); return 0; }
    if (plan.version) { stdout.write(`${JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version}\n`); return 0; }
    const secrets = await resolver(plan, env);
    const injected = inject(plan, secrets, env);
    return await execute(plan, injected, { stdout, stderr });
  } catch (error) {
    // All expected messages are authored locally; never print fetch/spawn errors,
    // which can contain authorization headers or expanded child arguments.
    stderr.write(`rtxexec: ${error instanceof UsageError ? error.message : "Execution failed; no diagnostic containing secret values was printed."}\n`);
    return 1;
  }
}
