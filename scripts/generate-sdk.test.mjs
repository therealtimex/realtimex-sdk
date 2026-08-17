import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
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

test('generated client serializes authenticated webhook management operations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'realtimex-sdk-webhook-admin-'));
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
        '/cli/create-webhook-endpoint': {
          post: {
            operationId: 'createWebhookEndpoint',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
            responses: { 201: { description: 'created' } },
          },
        },
        '/cli/update-webhook-endpoint/{endpointId}': {
          post: {
            operationId: 'updateWebhookEndpoint',
            parameters: [
              {
                name: 'endpointId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
            responses: { 200: { description: 'updated' } },
          },
        },
        '/cli/list-webhook-deliveries': {
          get: {
            operationId: 'listWebhookDeliveries',
            parameters: [
              { name: 'endpointId', in: 'query', schema: { type: 'string' } },
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
              { name: 'offset', in: 'query', schema: { type: 'integer' } },
            ],
            responses: { 200: { description: 'listed' } },
          },
        },
        '/cli/delete-webhook-endpoint/{endpointId}': {
          delete: {
            operationId: 'deleteWebhookEndpoint',
            parameters: [
              {
                name: 'endpointId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['confirmDestructive'],
                    properties: { confirmDestructive: { type: 'boolean' } },
                  },
                },
              },
            },
            responses: { 200: { description: 'deleted' } },
          },
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
    const generated = require(path.join(outDir, 'index.js'));
    const requests = [];
    const client = generated.createRealtimeXClient({
      baseUrl: 'https://desktop.example.test/cli',
      token: 'terminal-user-token',
      fetch: async (url, init) => {
        requests.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ success: true }),
        };
      },
    });

    await client.createWebhookEndpoint({
      name: 'Build tasks',
      workspaceId: 7,
      secret: 'write-only-secret',
    });
    await client.updateWebhookEndpoint('endpoint/1', { enabled: false });
    await client.listWebhookDeliveries({
      endpointId: 'endpoint/1',
      limit: 25,
      offset: 5,
    });
    await client.deleteWebhookEndpoint('endpoint/1', {
      confirmDestructive: true,
    });

    assert.deepEqual(
      requests.map(({ init }) => init.method),
      ['POST', 'POST', 'GET', 'DELETE']
    );
    assert.equal(
      requests[1].url,
      'https://desktop.example.test/cli/update-webhook-endpoint/endpoint%2F1'
    );
    assert.equal(
      requests[2].url,
      'https://desktop.example.test/cli/list-webhook-deliveries?endpointId=endpoint%2F1&limit=25&offset=5'
    );
    assert.equal(
      requests[3].url,
      'https://desktop.example.test/cli/delete-webhook-endpoint/endpoint%2F1'
    );
    assert.equal(
      requests[0].init.headers.Authorization,
      'Bearer terminal-user-token'
    );
    assert.deepEqual(JSON.parse(requests[3].init.body), {
      confirmDestructive: true,
    });
    assert.deepEqual(
      Object.keys(generated.operations).sort(),
      [
        'createWebhookEndpoint',
        'deleteWebhookEndpoint',
        'listWebhookDeliveries',
        'updateWebhookEndpoint',
      ]
    );
    assert.match(
      fs.readFileSync(path.join(outDir, 'index.d.ts'), 'utf8'),
      /deleteWebhookEndpoint\(endpointId: string, body: DeleteWebhookEndpointBody/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generated webhook client signs exact bytes and preserves retry identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'realtimex-sdk-webhook-'));
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
    const generated = require(path.join(outDir, 'index.js'));
    const requests = [];
    const payload = { prompt: 'Review this task', count: 2 };
    const body = JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha256', 'test-secret')
      .update(Buffer.from(body, 'utf8'))
      .digest('hex');
    const fetch = async (url, init) => {
      requests.push({ url, init });
      const retry = requests.length === 1;
      return {
        ok: !retry,
        status: retry ? 503 : 202,
        statusText: retry ? 'Unavailable' : 'Accepted',
        headers: { get: () => 'application/json' },
        text: async () =>
          JSON.stringify(
            retry
              ? { success: false }
              : {
                  success: true,
                  accepted: true,
                  duplicate: false,
                  deliveryId: 'stored-delivery',
                  threadId: 12,
                  taskId: 34,
                }
          ),
      };
    };
    const client = generated.createRealtimeXWebhookClient({
      endpointUrl: 'https://machine-b.example.test/api/v1/webhook-ingress/inbound/demo',
      secret: 'test-secret',
      fetch,
      maxRetries: 1,
    });

    const receipt = await client.trigger(payload, {
      deliveryId: 'task-123',
      timestamp: 1_700_000_000,
      retryDelayMs: 0,
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, requests[1].url);
    assert.equal(requests[0].init.body.toString('utf8'), body);
    assert.equal(requests[1].init.body.toString('utf8'), body);
    assert.equal(requests[0].init.headers['X-Webhook-Id'], 'task-123');
    assert.equal(requests[1].init.headers['X-Webhook-Id'], 'task-123');
    assert.equal(requests[0].init.headers['X-Webhook-Timestamp'], '1700000000');
    assert.equal(
      requests[0].init.headers['X-Webhook-Signature-256'],
      `sha256=${expectedSignature}`
    );
    assert.equal(requests[0].init.headers['X-Webhook-Event'], 'realtimex.task');
    assert.equal(requests[0].init.headers['X-Webhook-Source'], 'local-app');
    assert.equal(receipt.taskId, 34);
    assert.match(
      fs.readFileSync(path.join(outDir, 'index.d.ts'), 'utf8'),
      /createRealtimeXWebhookClient/
    );

    const environmentKeys = {
      REALTIMEX_WEBHOOK_SIGNATURE_HEADER: 'X-RealtimeX-Signature',
      REALTIMEX_WEBHOOK_SIGNATURE_PREFIX: 'hmac=',
      REALTIMEX_WEBHOOK_TIMESTAMP_HEADER: 'X-RealtimeX-Timestamp',
      REALTIMEX_WEBHOOK_DELIVERY_ID_HEADER: 'X-RealtimeX-Delivery',
      REALTIMEX_WEBHOOK_EVENT_TYPE_HEADER: 'X-RealtimeX-Event',
      REALTIMEX_WEBHOOK_SOURCE_HEADER: 'X-RealtimeX-Source',
    };
    const previousEnvironment = Object.fromEntries(
      Object.keys(environmentKeys).map((key) => [key, process.env[key]])
    );
    Object.assign(process.env, environmentKeys);
    try {
      let environmentRequest = null;
      const environmentClient = generated.createRealtimeXWebhookClient({
        endpointUrl: 'https://machine-b.example.test/webhook',
        secret: 'test-secret',
        maxRetries: 0,
        retryDelayMs: 0,
        fetch: async (_url, init) => {
          environmentRequest = init;
          return {
            ok: true,
            status: 202,
            statusText: 'Accepted',
            headers: { get: () => 'application/json' },
            text: async () => JSON.stringify({ success: true, accepted: true }),
          };
        },
      });

      await environmentClient.trigger({ prompt: 'environment headers' }, {
        deliveryId: 'environment-delivery',
        timestamp: 1_700_000_001,
      });
      assert.equal(
        environmentRequest.headers['X-RealtimeX-Delivery'],
        'environment-delivery'
      );
      assert.match(
        environmentRequest.headers['X-RealtimeX-Signature'],
        /^hmac=[a-f0-9]{64}$/
      );
      assert.equal(environmentClient.retryDelayMs, 0);
    } finally {
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generated webhook client surfaces timeout as a structured error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'realtimex-sdk-timeout-'));
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
    const { createRealtimeXWebhookClient, RealtimeXWebhookError } = require(
      path.join(outDir, 'index.js')
    );
    const client = createRealtimeXWebhookClient({
      endpointUrl: 'https://machine-b.example.test/webhook',
      secret: 'test-secret',
      maxRetries: 0,
      timeoutMs: 10,
      fetch: async (_url, { signal }) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    });

    await assert.rejects(
      client.trigger({ prompt: 'timeout' }),
      (error) =>
        error instanceof RealtimeXWebhookError &&
        error.message === 'RealtimeX webhook request timed out.'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
