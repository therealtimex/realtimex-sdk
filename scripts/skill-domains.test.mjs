import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOMAIN_SKILLS,
  assignOperationsToDomains,
  commandNameForOperation,
  parseCommandReference,
  renderDomainSkill,
  renderRouterSkill,
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

  const assignments = assignOperationsToDomains({ paths });

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

test('renders canonical v3 Delegate administration guidance', () => {
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
  assert.match(rendered, /get-delegate-boundary/);
  assert.match(rendered, /propose-delegate-boundary/);
  assert.match(rendered, /saved draft grants no authority/);
  assert.match(rendered, /Only an interactive Human session may activate/);
  assert.match(rendered, /Historical authority records are read-only audit data/);
  assert.match(rendered, /Never automatically retry Delegate mutations/);
  assert.match(rendered, /expected-revision 0/);
  assert.doesNotMatch(rendered, /expected-policy-version/);
});

test('renders the complete Delegate command catalog into one focused skill', () => {
  const operationIds = [
    'resolveDelegate',
    'getDelegateBoundary',
    'proposeDelegateBoundary',
    'provisionDelegate',
    'getDelegate',
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
