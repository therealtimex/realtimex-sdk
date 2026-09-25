import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishPackage, publishRelease } from './publish-pp-cli-packages.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxexec-publish-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [dir, name, version] of [
    ['rtxexec', '@realtimex/rtxexec', '0.1.0'],
    ['pp-cli/packages/linux-x64', '@realtimex/pp-cli-linux-x64', '2.0.36'],
    ['pp-cli/main', '@realtimex/pp-cli', '2.0.36'],
    ['typescript', '@realtimex/sdk', '2.0.36'],
  ]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify({ name, version }));
  }
  return root;
}

test('publishes rtxexec first with its independent version and skips it on retry', t => {
  const root = fixture(t);
  const published = new Map();
  const calls = [];
  const publish = directory => publishPackage(directory, {
    query: (_cmd, args) => {
      const version = published.get(args[1]);
      return version ? { status: 0, stdout: JSON.stringify(version) } : { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) };
    },
    execute: (command, args, { cwd }) => {
      assert.equal(command, 'npm');
      assert.deepEqual(args, ['publish', '--access', 'public', '--registry', 'https://registry.npmjs.org']);
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json')));
      const spec = `${pkg.name}@${pkg.version}`;
      calls.push(spec); published.set(spec, pkg.version);
    },
  });
  publishRelease(root, publish);
  assert.deepEqual(calls, ['@realtimex/rtxexec@0.1.0', '@realtimex/pp-cli-linux-x64@2.0.36', '@realtimex/pp-cli@2.0.36', '@realtimex/sdk@2.0.36']);
  publishRelease(root, publish);
  assert.equal(calls.length, 4);
});

test('stops before SDK publication when the rtxexec publish token is rejected', t => {
  const root = fixture(t);
  const attempted = [];
  assert.throws(() => publishRelease(root, dir => {
    attempted.push(path.basename(dir));
    publishPackage(dir, {
      query: () => ({ status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) }),
      execute: () => { throw new Error('npm publish E403'); },
    });
  }), /E403/);
  assert.deepEqual(attempted, ['rtxexec']);
});

for (const code of ['E401', 'E403', 'ENOTFOUND', 'E500']) {
  test(`does not publish after registry lookup fails with ${code}`, t => {
    const root = fixture(t);
    assert.throws(() => publishPackage(path.join(root, 'rtxexec'), {
      query: () => ({ status: 1, stdout: JSON.stringify({ error: { code } }) }),
      execute: () => assert.fail('must not attempt publish'),
    }), new RegExp(code));
  });
}

test('allows a missing version of an existing package', t => {
  const root = fixture(t);
  let published = false;
  assert.equal(publishPackage(path.join(root, 'rtxexec'), {
    query: () => ({ status: 1, stdout: JSON.stringify({ error: { code: 'ETARGET' } }) }),
    execute: () => { published = true; },
  }), 'published');
  assert.ok(published);
});
