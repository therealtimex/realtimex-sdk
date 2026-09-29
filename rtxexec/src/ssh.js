import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { UsageError } from './error.js';
import { resolveSecrets } from './client.js';

const run = promisify(execFile);
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
export function parseSshArguments(argv) {
  if (!argv[1]?.startsWith('secret://') || argv[1].includes('#') || argv[2] !== '--' || !argv[3]) throw new UsageError('Use rtxexec ssh secret://name -- ssh|git [arguments].');
  const name = path.win32.basename(path.basename(argv[3])).replace(/\.exe$/i, '').toLowerCase();
  if (!['ssh', 'git'].includes(name)) throw new UsageError('SSH key execution supports ssh and git.');
  return { references: [argv[1]], command: argv[3], args: argv.slice(4), ssh: true, sshCommand: name };
}

export async function runSsh(plan, env, execute, { resolver = resolveSecrets, root = tmpdir() } = {}) {
  const [credential] = await resolver(plan, env);
  if (typeof credential?.privateKey !== 'string' || !credential.privateKey.includes('-----BEGIN OPENSSH PRIVATE KEY-----') || Buffer.byteLength(credential.privateKey) > 65536) throw new UsageError('RealTimeX did not provide a usable SSH key.');
  let directory;
  try {
    directory = await mkdtemp(path.join(root, 'rtxexec-ssh-'));
    if (process.platform === 'win32') {
      // Secure the empty directory before writing material. Fail closed if ACLs
      // cannot be set (e.g. a non-NTFS temp directory).
      await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
    } else await chmod(directory, 0o700);
    const keyPath = path.join(directory, 'identity');
    await writeFile(keyPath, credential.privateKey, { mode: 0o600, flag: 'wx' });
    const sshArgs = ['-i', keyPath, '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none'];
    const childEnv = { ...env };
    let args = plan.args;
    if (plan.sshCommand === 'ssh') args = [...sshArgs, ...args];
    else {
      // Git consumes this command through its own shell. Only generated paths
      // and fixed options are included, with POSIX quoting (also used by Git for Windows).
      childEnv.GIT_SSH_COMMAND = ['ssh', ...sshArgs.map(value => process.platform === 'win32' ? value.replace(/\\/g, '/') : value)].map(quote).join(' ');
      childEnv.GIT_SSH_VARIANT = 'ssh';
    }
    return await execute(plan, { args, env: childEnv, stdin: undefined, values: [credential.privateKey] });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
