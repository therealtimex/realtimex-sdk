import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOMAIN_SKILLS,
  assignOperationsToDomains,
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
  assert.doesNotMatch(router, /## Command reference/);
});
