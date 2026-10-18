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

test('assigns all Decisions verbs to the moderator SDK Decisions skill', () => {
  const decisions = [
    ['/cli/decide', 'post', 'decide'],
    ['/cli/calibrate-decision-battery', 'post', 'calibrateDecisionBattery'],
    ['/cli/list-decision-batteries', 'get', 'listDecisionBatteries'],
  ];
  const paths = Object.fromEntries(decisions.map(([pathname, method, operationId]) => [
    pathname, { [method]: operation(operationId, 'Decisions') },
  ]));

  const { domains, pluginOwned } = assignOperationsToDomains({ paths });

  assert.equal(skillOwnersByTag().get('Decisions'), 'realtimex-decisions');
  assert.deepEqual(pluginOwned, []);
  assert.deepEqual(
    domains.get('realtimex-decisions').map(({ commandName }) => commandName),
    decisions.map(([pathname]) => pathname.slice('/cli/'.length))
  );
  assert.deepEqual([...domains.values()].flat(), domains.get('realtimex-decisions'));
});

// rtgit #2535: the per-workspace plugin commands belong to the plugin skill,
// which tells agents to use them instead of asking the Human.
test('assigns the workspace plugin commands to the plugin and skill skill', () => {
  const commands = [
    ['/cli/list-workspace-plugins', 'get', 'listWorkspacePlugins'],
    ['/cli/get-workspace-plugin/{pluginId}', 'get', 'getWorkspacePlugin'],
    ['/cli/set-workspace-plugin/{pluginId}', 'post', 'setWorkspacePlugin'],
    ['/cli/reset-workspace-plugin/{pluginId}', 'delete', 'resetWorkspacePlugin'],
  ];
  const paths = Object.fromEntries(commands.map(([pathname, method, operationId]) => [
    pathname, { [method]: operation(operationId, 'Plugins') },
  ]));

  const { domains, pluginOwned } = assignOperationsToDomains({ paths });

  assert.deepEqual(pluginOwned, []);
  assert.deepEqual(
    domains.get('realtimex-plugin-and-skill').map(({ commandName }) => commandName),
    ['list-workspace-plugins', 'get-workspace-plugin', 'set-workspace-plugin', 'reset-workspace-plugin']
  );

  const domain = DOMAIN_SKILLS.find(({ name }) => name === 'realtimex-plugin-and-skill');
  const markdown = `# Generated\n\n## Command Reference\n\n**set-workspace-plugin** — Set workspace plugin\n\n- \`realtimex-pp-cli set-workspace-plugin <pluginId>\`\n\n## Agent Mode\n`;
  const rendered = renderDomainSkill(
    domain,
    [{ operationId: 'setWorkspacePlugin', commandName: 'set-workspace-plugin' }],
    parseCommandReference(markdown),
    '9.8.7'
  );
  assert.match(rendered, /--workspace-slug <slug>/);
  assert.match(rendered, /do not ask the Human to make it in Workspace Settings/);
  assert.match(rendered, /--config KEY=VALUE/);
  assert.match(rendered, /needs its own `--yes`, which `--agent` does not supply/);
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

test('leaves Human question operations to the app-owned Human requests skill', () => {
  const questions = [
    ['/cli/ask-human', 'post', 'askHuman'],
    ['/cli/list-human-questions', 'get', 'listHumanQuestions'],
    ['/cli/get-human-question/{requestId}', 'get', 'getHumanQuestion'],
    ['/cli/resolve-human-question/{requestId}', 'post', 'resolveHumanQuestion'],
    ['/cli/cancel-human-question/{requestId}', 'post', 'cancelHumanQuestion'],
    ['/cli/resend-human-question/{requestId}', 'post', 'resendHumanQuestion'],
  ];
  const paths = {
    '/cli/list-workspaces': { get: operation('listWorkspaces', 'Workspaces') },
  };
  for (const [pathname, method, operationId] of questions) {
    paths[pathname] = { [method]: operation(operationId, 'Human Questions') };
  }

  const { domains, pluginOwned } = assignOperationsToDomains({ paths });

  assert.deepEqual(
    pluginOwned.map(({ operationId, owner }) => [operationId, owner]),
    questions.map(([, , operationId]) => [operationId, 'com.realtimex.moderator-sdk/realtimex-human-requests'])
  );
  assert.deepEqual(
    [...domains.values()].flat().map(({ operationId }) => operationId),
    ['listWorkspaces']
  );
  const sdkSkillNames = [ROUTER_SKILL.name, ...DOMAIN_SKILLS.map(({ name }) => name)];
  assert.ok(!sdkSkillNames.includes('realtimex-human-requests'));
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
