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
  'get-delegate-boundary',
  'propose-delegate-boundary',
  'provision-delegate',
  'get-delegate',
  'suspend-delegate',
  'resume-delegate',
  'revoke-delegate-outstanding',
  'get-delegate-decision',
  'list-delegate-executions',
  'get-delegate-execution',
];
const retiredCommandNames = [
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
  for (const commandName of retiredCommandNames) {
    assert.doesNotMatch(rootHelp.stdout, new RegExp(commandName));
  }

  const readBoundary = await run(
    [
      'get-delegate-boundary',
      '--scope-kind',
      'workspace-team',
      '--scope-id',
      '7',
      '--agent',
    ],
    baseUrl
  );
  assert.equal(readBoundary.code, 0, readBoundary.stderr);
  const boundaryRequest = requests.at(-1);
  const boundaryUrl = new URL(boundaryRequest.url, baseUrl);
  assert.equal(boundaryUrl.pathname, '/cli/get-delegate-boundary');
  assert.equal(boundaryUrl.searchParams.get('scopeKind'), 'workspace-team');
  assert.equal(boundaryUrl.searchParams.get('scopeId'), '7');

  const proposal = await run(
    [
      'propose-delegate-boundary',
      '--scope-kind',
      'workspace-team',
      '--scope-id',
      '7',
      '--markdown',
      '# Delegate boundary\n\n## Must escalate\n\n- Ambiguity.',
      '--expected-revision',
      '0',
      '--agent',
    ],
    baseUrl
  );
  assert.equal(proposal.code, 0, proposal.stderr);
  const proposalRequest = requests.at(-1);
  assert.equal(proposalRequest.url, '/cli/propose-delegate-boundary');
  assert.equal(proposalRequest.body.scopeKind, 'workspace-team');
  assert.equal(proposalRequest.body.scopeId, '7');
  assert.equal(proposalRequest.body.expectedRevision, 0);
  assert.match(proposalRequest.body.markdown, /^# Delegate boundary/);
  assert.equal(
    proposalRequest.authorization,
    'RealtimeX-Terminal terminal-token'
  );

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
