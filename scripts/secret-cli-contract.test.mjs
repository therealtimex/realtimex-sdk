import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const binary = process.env.REALTIMEX_SECRET_TEST_CLI;
test('compiled secret commands keep values off argv and preserve scope semantics', { skip: !binary }, async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    requests.push({ path: req.url, body: JSON.parse(raw), token: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, secret: { id: 'test-id', name: 'test-secret' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  async function run(args, value = '') {
    const child = spawn(binary, [...args, '--json', '--no-cache'], {
      env: { ...process.env, REALTIMEX_BASE_URL: `http://127.0.0.1:${server.address().port}/cli`, REALTIMEX_TERMINAL_SESSION_TOKEN: 'fixture-session-token' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (part) => output += part);
    child.stderr.on('data', (part) => output += part);
    child.stdin.on('error', () => {});
    child.stdin.end(value);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    return { code, output };
  }
  try {
    const value = 'fixture-only-secret\nsecond-line\n';
    const created = await run(['create-secret', '--name', 'test-secret', '--value-stdin'], value);
    assert.equal(created.code, 0, created.output);
    assert.ok(!created.output.includes(value));
    assert.equal(requests[0].body.value, value);
    assert.equal(requests[0].token, 'RealtimeX-Terminal fixture-session-token');
    assert.equal(requests[0].path, '/cli/create-secret');
    const updated = await run(['update-secret', 'test-id', '--description=', '--all-workspaces', '--enabled=false']);
    assert.equal(updated.code, 0, updated.output);
    assert.deepEqual(requests[1].body, { description: '', workspaceSlugs: null, enabled: false });
    const denied = await run(['update-secret', 'test-id', '--value-stdin', '--dry-run'], value);
    assert.notEqual(denied.code, 0);
    assert.ok(!denied.output.includes(value));
    assert.equal(requests.length, 2);
    const scoped = await run(['update-secret', 'test-id', '--workspace-slugs=team,project']);
    assert.equal(scoped.code, 0, scoped.output);
    assert.deepEqual(requests[2].body.workspaceSlugs, ['team', 'project']);
    const pair = { username: 'fixture-private-user', password: 'fixture-private-password' };
    const login = await run(['create-secret', '--name', 'login', '--kind', 'login', '--login-url', 'https://example.com/login', '--login-stdin'], JSON.stringify(pair));
    assert.equal(login.code, 0, login.output);
    assert.deepEqual(requests[3].body, { name: 'login', kind: 'login', loginUrl: 'https://example.com/login', ...pair });
    assert.ok(!login.output.includes(pair.username)); assert.ok(!login.output.includes(pair.password));
    const rotate = await run(['update-secret', 'test-id', '--login-stdin'], JSON.stringify({ password: 'replacement' }));
    assert.equal(rotate.code, 0, rotate.output);
    assert.deepEqual(requests[4].body, { password: 'replacement' });
    for (const args of [['--login-stdin', '--dry-run'], ['--login-stdin', '--value-stdin'], ['--username', 'test'], ['--password', 'test']]) {
      const rejected = await run(['update-secret', 'test-id', ...args], JSON.stringify(pair));
      assert.notEqual(rejected.code, 0); assert.ok(!rejected.output.includes(pair.password));
    }
    const malformed = await run(['update-secret', 'test-id', '--login-stdin'], '{"password":"fixture-private-password",');
    assert.notEqual(malformed.code, 0); assert.ok(!malformed.output.includes(pair.password));
    assert.equal(requests.length, 5);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
