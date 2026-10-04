import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DOMAIN_SKILLS,
  ROUTER_SKILL,
  assignOperationsToDomains,
  commandNameForOperation,
  parseCommandReference,
  renderDomainSkill,
  renderRouterSkill,
  skillOwnersByTag,
} from './skill-domains.mjs';

function operation(operationId, tag) {
  return {
    operationId,
    tags: [tag],
    responses: { 200: { description: 'ok' } },
  };
}

test('assigns every focused capability to one directly named skill', () => {
  const paths = {};
  for (const [index, domain] of DOMAIN_SKILLS.entries()) {
    paths[`/cli/capability-${index}`] = {
      get: operation(`capability${index}`, domain.tags[0]),
    };
  }
  paths['/cli/setup-heartbeat-tasks'] = {
    get: operation('setupHeartbeatTasks', 'Personality'),
  };

  const { domains: assignments } = assignOperationsToDomains({ paths });

  for (const [index, domain] of DOMAIN_SKILLS.entries()) {
    assert.equal(assignments.get(domain.name)[0].operationId, `capability${index}`);
  }
  assert.ok(
    assignments
      .get('realtimex-heartbeat')
      .some(({ operationId }) => operationId === 'setupHeartbeatTasks')
  );
});

test('fails generation when a CLI operation has no skill owner', () => {
  assert.throws(
    () =>
      assignOperationsToDomains({
        paths: {
          '/cli/unknown': {
            post: operation('unknownCapability', 'New Unassigned Tag'),
          },
        },
      }),
    /unknownCapability.*no skill owner/
  );
});

test('leaves Memory operations to the RealTimeX Memory plugin skill', () => {
  const memory = [
    ['/cli/read-memory', 'get', 'readMemory'],
    ['/cli/write-memory', 'put', 'writeMemory'],
    ['/cli/search-memory', 'get', 'searchMemory'],
    ['/cli/forget-memory', 'post', 'forgetMemory'],
    ['/cli/get-memory-status', 'get', 'getMemoryStatus'],
  ];
  const paths = {
    '/cli/list-workspaces': { get: operation('listWorkspaces', 'Workspaces') },
  };
  for (const [pathname, method, operationId] of memory) {
    paths[pathname] = { [method]: operation(operationId, 'Memory') };
  }

  const { domains, pluginOwned } = assignOperationsToDomains({ paths });

  assert.deepEqual(
    pluginOwned.map(({ commandName, owner }) => [commandName, owner]),
    memory.map(([pathname]) => [
      pathname.slice('/cli/'.length),
      'com.realtimex.memory/realtimex-memory',
    ])
  );
  assert.deepEqual(
    [...domains.values()].flat().map(({ operationId }) => operationId),
    ['listWorkspaces']
  );
  const sdkSkillNames = [ROUTER_SKILL.name, ...DOMAIN_SKILLS.map(({ name }) => name)];
  assert.ok(!sdkSkillNames.includes('realtimex-memory'));
  assert.doesNotMatch(renderRouterSkill('9.8.7'), /realtimex-memory/);
});

test('fails generation when a Memory operation also carries an SDK skill tag', () => {
  assert.throws(
    () =>
      assignOperationsToDomains({
        paths: {
          '/cli/read-memory': {
            get: { ...operation('readMemory', 'Memory'), tags: ['Memory', 'Workspaces'] },
          },
        },
      }),
    /readMemory.*multiple skill owners: com\.realtimex\.memory\/realtimex-memory, realtimex-workspaces/
  );
});

test('rejects a plugin skill owner that shares an SDK skill tag or name', () => {
  assert.equal(skillOwnersByTag().get('Memory'), 'com.realtimex.memory/realtimex-memory');
  assert.throws(
    () =>
      skillOwnersByTag(DOMAIN_SKILLS, [
        { pluginId: 'com.example', skill: 'example', tags: ['Workspaces'] },
      ]),
    /tag is assigned to multiple skills: Workspaces/
  );
  for (const skill of [ROUTER_SKILL.name, 'realtimex-workspaces']) {
    assert.throws(
      () => skillOwnersByTag(DOMAIN_SKILLS, [{ pluginId: 'com.example', skill, tags: ['Other'] }]),
      /collides with a generated SDK skill name/
    );
  }
});

test('pins the rtxexec version published from this repository', () => {
  const { version } = JSON.parse(
    readFileSync(new URL('../rtxexec/package.json', import.meta.url), 'utf8')
  );
  const pins = DOMAIN_SKILLS.flatMap(({ guidance }) =>
    guidance.flatMap((rule) => [...rule.matchAll(/@realtimex\/rtxexec@([\w.-]*\w)/g)].map((match) => match[1]))
  );

  assert.ok(pins.length > 0);
  assert.deepEqual(new Set(pins), new Set([version]));
});

test('renders a concise router and only the selected domain command blocks', () => {
  const markdown = `# Generated\n\n## Command Reference\n\n**list-workspaces** — List workspaces\n\n- \`realtimex-pp-cli list-workspaces\`\n\n**list-channels** — List channels\n\n- \`realtimex-pp-cli list-channels\`\n\n### Finding the right command\n\nHelp\n\n## Agent Mode\n`;
  const blocks = parseCommandReference(markdown);
  const workspace = DOMAIN_SKILLS.find(
    ({ name }) => name === 'realtimex-workspaces'
  );
  const rendered = renderDomainSkill(
    workspace,
    [
      {
        operationId: 'listWorkspaces',
        commandName: 'list-workspaces',
      },
    ],
    blocks,
    '9.8.7'
  );
  const router = renderRouterSkill('9.8.7');

  assert.match(rendered, /name: realtimex-workspaces/);
  assert.match(rendered, /\*\*list-workspaces\*\*/);
  assert.doesNotMatch(rendered, /\*\*list-channels\*\*/);
  assert.match(rendered, /@realtimex\/pp-cli@9\.8\.7/);
  assert.match(router, /`realtimex-heartbeat`/);
  assert.match(router, /`realtimex-artifacts`/);
  assert.match(router, /`realtimex-channels`/);
  assert.match(router, /`realtimex-plugin-and-skill`/);
  assert.match(router, /`realtimex-delegates`/);
  assert.doesNotMatch(router, /## Command reference/);
});

test('renders Delegate authority guidance separately from topology deployment', () => {
  const delegate = DOMAIN_SKILLS.find(
    ({ name }) => name === 'realtimex-delegates'
  );
  const markdown = `# Generated\n\n## Command Reference\n\n**resolve-delegate** — Resolve Delegate\n\n- \`realtimex-pp-cli resolve-delegate\`\n\n## Agent Mode\n`;
  const rendered = renderDomainSkill(
    delegate,
    [{ operationId: 'resolveDelegate', commandName: 'resolve-delegate' }],
    parseCommandReference(markdown),
    '9.8.7'
  );

  assert.match(rendered, /configure-plugin.*topology deployment only/);
  assert.match(rendered, /project topology assignment id/);
  assert.match(rendered, /Never automatically retry Delegate mutations/);
  assert.match(rendered, /expected-revision 0/);
  assert.match(rendered, /expected-policy-version none/);
});

test('renders the complete Delegate command catalog into one focused skill', () => {
  const operationIds = [
    'resolveDelegate',
    'provisionDelegate',
    'getDelegate',
    'getDelegatePolicyDraft',
    'saveDelegatePolicyDraft',
    'compileDelegatePolicy',
    'listDelegateCompilerJobs',
    'getDelegateCompilerJob',
    'cancelDelegateCompilerJob',
    'retryDelegateCompilerJob',
    'getDelegatePolicyCandidate',
    'simulateDelegatePolicy',
    'activateDelegatePolicy',
    'listDelegatePolicyVersions',
    'getDelegatePolicyVersion',
    'suspendDelegate',
    'resumeDelegate',
    'revokeDelegateOutstanding',
    'getDelegateDecision',
    'listDelegateExecutions',
    'getDelegateExecution',
  ];
  const commandNames = operationIds.map(commandNameForOperation);
  const markdown = `# Generated\n\n## Command Reference\n\n${commandNames
    .map(
      (commandName) =>
        `**${commandName}** — Generated Delegate command\n\n- \`realtimex-pp-cli ${commandName}\``
    )
    .join('\n\n')}\n\n## Agent Mode\n`;
  const delegate = DOMAIN_SKILLS.find(
    ({ name }) => name === 'realtimex-delegates'
  );
  const rendered = renderDomainSkill(
    delegate,
    operationIds.map((operationId, index) => ({
      operationId,
      commandName: commandNames[index],
    })),
    parseCommandReference(markdown),
    '9.8.7'
  );

  for (const commandName of commandNames) {
    assert.match(rendered, new RegExp(`\\*\\*${commandName}\\*\\*`));
  }
  assert.equal(
    [...rendered.matchAll(/^\*\*[^*]+\*\*/gm)].length,
    operationIds.length
  );
});
