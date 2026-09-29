import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseSshArguments, runSsh } from '../src/ssh.js';

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
