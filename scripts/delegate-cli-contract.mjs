#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const argv = process.argv.slice(2);
const binaryArgument =
  argv[0] === '--binary' ? argv[1] : process.env.REALTIMEX_PP_CLI_BINARY;
if (!binaryArgument) {
  throw new Error(
    'Usage: node scripts/delegate-cli-contract.mjs --binary /path/to/realtimex-pp-cli'
  );
}
const binary = path.resolve(binaryArgument);
if (!fs.existsSync(binary)) {
  throw new Error(`Generated CLI binary not found: ${binary}`);
}

const commandNames = [
  'resolve-delegate',
  'provision-delegate',
  'get-delegate',
  'get-delegate-policy-draft',
  'save-delegate-policy-draft',
  'compile-delegate-policy',
  'list-delegate-compiler-jobs',
  'get-delegate-compiler-job',
  'cancel-delegate-compiler-job',
  'retry-delegate-compiler-job',
  'get-delegate-policy-candidate',
  'simulate-delegate-policy',
  'activate-delegate-policy',
  'list-delegate-policy-versions',
  'get-delegate-policy-version',
  'suspend-delegate',
  'resume-delegate',
  'revoke-delegate-outstanding',
  'get-delegate-decision',
  'list-delegate-executions',
  'get-delegate-execution',
];
const requests = [];
const requestCounts = new Map();

function writeJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString('utf8');
  const entry = {
    method: request.method,
    url: request.url,
    authorization: request.headers.authorization,
    body: bodyText ? JSON.parse(bodyText) : null,
  };
  requests.push(entry);
  requestCounts.set(
    request.url,
    (requestCounts.get(request.url) || 0) + 1
  );

  if (request.url === '/cli/suspend-delegate/instance-error') {
    return writeJson(response, 503, {
      success: false,
      error: 'state uncertain',
      code: 'DELEGATE_STATE_UNCERTAIN',
      details: { recovery: 'get-delegate' },
    });
  }
  if (request.url === '/cli/get-delegate/read-retry') {
    if (requestCounts.get(request.url) === 1) {
      return writeJson(response, 503, {
        success: false,
        error: 'temporary',
        code: 'TEMPORARY',
      });
    }
    return writeJson(response, 200, {
      success: true,
      instance: { id: 'read-retry', status: 'active' },
    });
  }
  if (request.url.startsWith('/cli/compile-delegate-policy/')) {
    return writeJson(response, 202, {
      success: true,
      created: true,
      job: { id: 'job-pending', state: 'queued' },
    });
  }
  return writeJson(response, 200, {
    success: true,
    id: 'ok',
    status: 'active',
  });
});

function run(args, baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: {
        ...process.env,
        REALTIMEX_BASE_URL: baseUrl,
        REALTIMEX_TERMINAL_SESSION_TOKEN: 'terminal-token',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}/cli`;

try {
  const rootHelp = await run(['--help'], baseUrl);
  assert.equal(rootHelp.code, 0, rootHelp.stderr);
  for (const commandName of commandNames) {
    assert.match(rootHelp.stdout, new RegExp(commandName));
    const commandHelp = await run([commandName, '--help'], baseUrl);
    assert.equal(commandHelp.code, 0, commandHelp.stderr);
    assert.match(
      `${commandHelp.stdout}\n${commandHelp.stderr}`,
      new RegExp(commandName)
    );
  }

  const save = await run(
    [
      'save-delegate-policy-draft',
      'instance/one',
      '--expected-revision',
      '0',
      '--sources',
      '[{"id":"policy","text":"Allow bounded work","enabled":true}]',
      '--clarification-answers',
      '[{"candidateId":"candidate-1","answer":"yes"}]',
      '--agent',
    ],
    baseUrl
  );
  assert.equal(save.code, 0, save.stderr);
  const saveRequest = requests.at(-1);
  assert.equal(saveRequest.url, '/cli/save-delegate-policy-draft/instance%2Fone');
  assert.equal(saveRequest.body.expectedRevision, 0);
  assert.deepEqual(saveRequest.body.sources, [
    { id: 'policy', text: 'Allow bounded work', enabled: true },
  ]);
  assert.ok(Array.isArray(saveRequest.body.clarificationAnswers));
  assert.equal(
    saveRequest.authorization,
    'RealtimeX-Terminal terminal-token'
  );

  const simulation = await run(
    [
      'simulate-delegate-policy',
      'instance/one',
      'candidate/two',
      '--scenario-id',
      'scenario-1',
      '--fact-overrides',
      '[{"path":"effects.money.amountMinor","value":100}]',
      '--agent',
    ],
    baseUrl
  );
  assert.equal(simulation.code, 0, simulation.stderr);
  const simulationRequest = requests.at(-1);
  assert.equal(
    simulationRequest.url,
    '/cli/simulate-delegate-policy/instance%2Fone/candidate%2Ftwo'
  );
  assert.deepEqual(simulationRequest.body.factOverrides, [
    { path: 'effects.money.amountMinor', value: 100 },
  ]);

  const activation = await run(
    [
      'activate-delegate-policy',
      'instance/one',
      'candidate/two',
      '--confirm-instance-id',
      'instance/one',
      '--expected-draft-revision',
      '1',
      '--expected-policy-version',
      'none',
      '--expected-authority-epoch',
      '1',
      '--expected-agent-config-revision',
      '1',
      '--agent',
    ],
    baseUrl
  );
  assert.equal(activation.code, 0, activation.stderr);
  const activationRequest = requests.at(-1);
  assert.equal(
    activationRequest.url,
    '/cli/activate-delegate-policy/instance%2Fone/candidate%2Ftwo'
  );
  assert.equal(activationRequest.body.expectedPolicyVersion, 'none');
  assert.equal(activationRequest.body.confirmInstanceId, 'instance/one');

  const compile = await run(
    ['compile-delegate-policy', 'instance/one', '1', '--agent'],
    baseUrl
  );
  assert.equal(compile.code, 0, compile.stderr);
  assert.match(compile.stdout, /job-pending/);
  assert.match(compile.stdout, /queued/);

  const failedMutation = await run(
    [
      'suspend-delegate',
      'instance-error',
      '--confirm-instance-id',
      'instance-error',
      '--agent',
    ],
    baseUrl
  );
  assert.equal(requestCounts.get('/cli/suspend-delegate/instance-error'), 1);
  assert.notEqual(failedMutation.code, 0);
  const errorEnvelope = JSON.parse(
    failedMutation.stdout.trim().split('\n')[0]
  );
  assert.equal(errorEnvelope.status, 503);
  assert.equal(errorEnvelope.code, 'DELEGATE_STATE_UNCERTAIN');
  assert.equal(errorEnvelope.message, 'state uncertain');
  assert.deepEqual(errorEnvelope.details, { recovery: 'get-delegate' });

  const retriedRead = await run(
    [
      'get-delegate',
      'read-retry',
      '--data-source',
      'live',
      '--no-cache',
      '--agent',
    ],
    baseUrl
  );
  assert.equal(retriedRead.code, 0, retriedRead.stderr);
  assert.equal(requestCounts.get('/cli/get-delegate/read-retry'), 2);

  process.stdout.write(
    `${JSON.stringify({
      commands: commandNames.length,
      helpCommands: commandNames.length,
      requests: requests.length,
      mutationAttempts: requestCounts.get(
        '/cli/suspend-delegate/instance-error'
      ),
      readAttempts: requestCounts.get('/cli/get-delegate/read-retry'),
    })}\n`
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
