import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('generated client requires or consumes the propagated runtime endpoint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'realtimex-sdk-generate-'));
  const outDir = path.join(root, 'out');
  const specPath = path.join(root, 'openapi.json');
  fs.mkdirSync(outDir);
  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    JSON.stringify({ name: '@realtimex/sdk-test', version: '0.0.0' })
  );
  fs.writeFileSync(
    specPath,
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'fixture', version: '1' },
      paths: {
        '/cli/ping': {
          get: { operationId: 'ping', responses: { 200: { description: 'ok' } } },
        },
      },
    })
  );

  try {
    execFileSync(process.execPath, [
      path.resolve('scripts/generate-sdk.mjs'),
      '--spec',
      specPath,
      '--out',
      outDir,
    ]);
    const { createRealtimeXClient } = require(path.join(outDir, 'index.js'));

    const previous = process.env.REALTIMEX_BASE_URL;
    delete process.env.REALTIMEX_BASE_URL;
    try {
      assert.throws(() => createRealtimeXClient(), /base URL is unavailable/);
      assert.equal(
        createRealtimeXClient({ baseUrl: 'http://127.0.0.1:46101/cli' }).baseUrl,
        'http://127.0.0.1:46101/cli'
      );
      process.env.REALTIMEX_BASE_URL = 'http://127.0.0.1:46201/cli';
      assert.equal(
        createRealtimeXClient().baseUrl,
        'http://127.0.0.1:46201/cli'
      );
    } finally {
      if (previous === undefined) delete process.env.REALTIMEX_BASE_URL;
      else process.env.REALTIMEX_BASE_URL = previous;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
