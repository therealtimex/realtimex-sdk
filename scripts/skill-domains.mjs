const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

export const ROUTER_SKILL = {
  name: 'realtimex-moderator-sdk',
  title: 'RealTimeX Moderator SDK Router',
  description:
    'Route RealTimeX API work to the focused workspace, terminal-agent, browser-session, local-app, heartbeat, automation-flow, artifact, channel, webhook, or plugin-and-skill capability. Use when a request spans capabilities or the correct RealTimeX skill is unclear.',
};

export const DOMAIN_SKILLS = [
  {
    name: 'realtimex-workspaces',
    title: 'RealTimeX Workspaces',
    description:
      'Manage RealTimeX workspaces, threads, messages, workspace personality, LLM configuration, and default agents. Use for workspace and conversation operations.',
    tags: ['Prepare', 'Personality', 'Workspaces', 'Threads', 'Messages', 'LLM'],
    guidance: [
      'Use `prepare` as the source of truth for the current workspace, thread, available agents, providers, and models.',
      'For `send-message`, require an explicit or unambiguous workspace, thread, and message. The server selects the thread model.',
      'For workspace default-agent changes, use exact agent canonical and model values returned by `prepare`.',
    ],
  },
  {
    name: 'realtimex-terminal-agents',
    title: 'RealTimeX Terminal Agents',
    description:
      'Manage RealTimeX terminal agents, terminal sessions, session messages, and idle prompts. Use for desktop terminal-agent runtime and terminal-session lifecycle work.',
    tags: ['Terminal Sessions'],
    guidance: [
      'Discover available agents before opening a session and use exact agent, provider, and model identifiers.',
      'Use list operations before resume, stop, or terminate actions; preserve the exact session identifier.',
      'Respond to an idle prompt only when the reported session and event sequence still match.',
    ],
  },
  {
    name: 'realtimex-browser-sessions',
    title: 'RealTimeX Browser Sessions',
    description:
      'List, create, start, stop, and delete isolated RealTimeX browser sessions. Use for named browser runtime and profile lifecycle work.',
    tags: ['Browser Sessions'],
    guidance: [
      'List browser sessions before lifecycle changes and use the exact returned session name.',
      'Create a named session before starting it; stop it before permanent deletion.',
      'Treat each named browser session as an isolated profile and do not substitute terminal-session identifiers.',
    ],
  },
  {
    name: 'realtimex-local-apps',
    title: 'RealTimeX Local Apps',
    description:
      'Create, inspect, configure, start, stop, restart, and delete RealTimeX Local Apps. Use for local source, npx, uvx, webhook-trigger, status, log, and lifecycle operations.',
    tags: ['Local Apps'],
    guidance: [
      'List or inspect an app before changing lifecycle or configuration state, and use the exact app identifier returned by the server.',
      'Treat endpoint association and runtime state as server-owned values; confirm status after start, stop, or restart.',
      'Use bounded log reads for diagnosis and require explicit user intent before permanent app deletion.',
    ],
  },
  {
    name: 'realtimex-heartbeat',
    title: 'RealTimeX Heartbeat',
    description:
      'Configure RealTimeX heartbeat scheduling, agents, active hours, timezone, autopilot, and immediate workspace heartbeat runs. Use for recurring HEARTBEAT.md task execution.',
    tags: ['Heartbeat'],
    guidance: [
      'Keep heartbeat instructions in `HEARTBEAT.md`; use the bundled template when creating it.',
      'Inspect the current workspace context before changing heartbeat configuration or triggering tasks.',
      'Use exact task names from `HEARTBEAT.md` when triggering selected heartbeat tasks.',
    ],
  },
  {
    name: 'realtimex-automation-flows',
    title: 'RealTimeX Automation Flows',
    description:
      'Run RealTimeX automation workflows and guided automation-flow commands, including working-directory setup and workspace layout. Use for explicit multi-step automation execution.',
    tags: ['Automation Flows'],
    guidance: [
      'Do not automatically retry workflow timeouts or server errors; report the failure so the user can decide.',
      'Resolve current workspace and thread context before running a flow that depends on them.',
      'Use the explicit generated flow command when one exists; use the generic workflow command only for supported workflow input.',
    ],
  },
  {
    name: 'realtimex-artifacts',
    title: 'RealTimeX Artifacts',
    description:
      'List, publish, inspect, pause, resume, and revoke RealTimeX workspace artifacts. Use for browser-viewable artifact publication and lifecycle management.',
    tags: ['Artifacts'],
    guidance: [
      'Place publishable files or folders under the workspace `artifacts/` directory before publishing.',
      'Use the exact artifact identifier returned by list or publish operations for lifecycle changes.',
      'Treat revoke as the permanent serving-state action and require an explicit target.',
    ],
  },
  {
    name: 'realtimex-channels',
    title: 'RealTimeX Channels',
    description:
      'Create, configure, start, stop, and delete RealTimeX chat channels, approve pairing codes, and deliver channel files. Use for Telegram, Zalo, Discord, and other channel integrations.',
    tags: ['Channels'],
    guidance: [
      'List channels before changing them and use the exact channel identifier returned by the server.',
      'Use an explicit channel delivery context when sending a file, and send one file per command.',
      'Approve only the pairing code explicitly presented by the user or current channel flow.',
    ],
  },
  {
    name: 'realtimex-webhooks',
    title: 'RealTimeX Webhooks',
    description:
      'Create, inspect, update, test, and delete RealTimeX public webhook endpoints and inspect bounded delivery metadata. Use for inbound public webhook trigger configuration.',
    tags: ['Webhooks'],
    guidance: [
      'Treat webhook secrets as write-only input. Never expect or expose plaintext secrets from endpoint responses.',
      'Inspect webhook deliveries only through the bounded delivery-list command; raw payload and signature material are intentionally unavailable.',
      'Require explicit confirmation before permanent webhook endpoint deletion.',
    ],
  },
  {
    name: 'realtimex-plugin-and-skill',
    title: 'RealTimeX Plugins and Skills',
    description:
      'Manage RealTimeX plugins and agent skills, including configuration, enablement, reload, installation, promotion, and workspace skill state. Use for plugin and skill administration.',
    tags: ['Plugins', 'Agent Skills'],
    guidance: [
      'List plugins or skills before changing them and use the exact returned identifier.',
      'Inspect a plugin schema before configuration and never invent configuration keys.',
      'After reloading agent skills, reload the caller skill context before relying on changed instructions.',
    ],
  },
];

const OPERATION_DOMAIN_OVERRIDES = {
  setupHeartbeatTasks: 'realtimex-heartbeat',
};

export function commandNameForOperation(operationId) {
  return operationId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

export function assignOperationsToDomains(spec, prefix = '/cli') {
  const domainsByTag = new Map();
  for (const domain of DOMAIN_SKILLS) {
    for (const tag of domain.tags) {
      if (domainsByTag.has(tag)) {
        throw new Error(`OpenAPI tag is assigned to multiple skills: ${tag}`);
      }
      domainsByTag.set(tag, domain.name);
    }
  }

  const assignments = new Map(DOMAIN_SKILLS.map((domain) => [domain.name, []]));
  const seenOperationIds = new Set();
  const failures = [];

  for (const [pathname, pathItem] of Object.entries(spec.paths || {})) {
    if (prefix && !pathname.startsWith(prefix)) continue;
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!HTTP_METHODS.has(method) || !operation?.operationId) continue;
      if (seenOperationIds.has(operation.operationId)) {
        failures.push(`duplicate operationId ${operation.operationId}`);
        continue;
      }
      seenOperationIds.add(operation.operationId);

      const override = OPERATION_DOMAIN_OVERRIDES[operation.operationId];
      const candidates = new Set(
        override
          ? [override]
          : (operation.tags || []).map((tag) => domainsByTag.get(tag)).filter(Boolean)
      );
      if (candidates.size !== 1) {
        failures.push(
          `${method.toUpperCase()} ${pathname} (${operation.operationId}) has ${
            candidates.size ? `multiple skill owners: ${[...candidates].join(', ')}` : 'no skill owner'
          }; tags: ${(operation.tags || []).join(', ') || '(none)'}`
        );
        continue;
      }
      const domainName = [...candidates][0];
      if (!assignments.has(domainName)) {
        failures.push(`${operation.operationId} overrides to unknown skill ${domainName}`);
        continue;
      }
      assignments.get(domainName).push({
        operationId: operation.operationId,
        commandName: commandNameForOperation(operation.operationId),
        method: method.toUpperCase(),
        pathname,
        tags: operation.tags || [],
      });
    }
  }

  if (failures.length) {
    throw new Error(`CLI skill ownership validation failed:\n- ${failures.join('\n- ')}`);
  }
  if (!seenOperationIds.size) {
    throw new Error(`No CLI operations found under ${prefix || '(all paths)'}`);
  }
  return assignments;
}

export function parseCommandReference(markdown) {
  const section = markdown.match(/(?:^|\n)## Command Reference\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!section) throw new Error('Generated Printing Press skill has no Command Reference section.');

  const blocks = new Map();
  for (const match of section[1].matchAll(/(?:^|\n)(\*\*([^*]+)\*\*[\s\S]*?)(?=\n\*\*|\n### |$)/g)) {
    blocks.set(match[2].trim(), match[1].trim());
  }
  if (!blocks.size) throw new Error('Generated Printing Press skill has no command blocks.');
  return blocks;
}

function renderFrontmatter(skill) {
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\nallowed-tools: "Read Bash"\nmetadata:\n  openclaw:\n    requires:\n      bins:\n        - realtimex-pp-cli\n---`;
}

function renderSharedUsage(version) {
  return `## CLI setup\n\nThis skill uses \`realtimex-pp-cli\` version ${version}. Before using its commands:\n\n\`\`\`bash\nrealtimex-pp-cli --version\n\`\`\`\n\nIf it is missing or does not report \`realtimex-pp-cli ${version}\`, install the pinned version:\n\n\`\`\`bash\nnpm install -g @realtimex/pp-cli@${version}\n\`\`\`\n\nFor requests about the current workspace or thread, resolve context first:\n\n\`\`\`bash\nrealtimex-pp-cli prepare --agent\n\`\`\``;
}

export function renderDomainSkill(domain, operations, commandBlocks, version) {
  const selectedBlocks = [];
  const operationByCommand = new Map(
    operations.map((operation) => [operation.commandName, operation])
  );
  for (const [commandName, block] of commandBlocks) {
    if (operationByCommand.has(commandName)) selectedBlocks.push(block);
  }
  const missingCommands = [...operationByCommand.keys()].filter(
    (commandName) => !commandBlocks.has(commandName)
  );
  // A templated dispatcher route can own aliases without producing a literal CLI command.
  const unexpectedMissing = missingCommands.filter(
    (commandName) => commandName !== 'run-automation-flow'
  );
  if (unexpectedMissing.length) {
    throw new Error(
      `${domain.name} is missing generated command blocks: ${unexpectedMissing.join(', ')}`
    );
  }
  if (!selectedBlocks.length) {
    throw new Error(`${domain.name} has no generated command blocks.`);
  }

  return `${renderFrontmatter(domain)}\n\n# ${domain.title}\n\n${domain.description}\n\n${renderSharedUsage(version)}\n\n## Command reference\n\n${selectedBlocks.join('\n\n')}\n\n## Domain rules\n\n${domain.guidance.map((rule) => `- ${rule}`).join('\n')}\n\n## Shared constraints\n\n- Run documented commands with \`--agent\`.\n- Use exact identifiers returned by \`prepare\` or the relevant list/get command; do not guess values.\n- Do not bypass the CLI with raw HTTP calls. If a required operation is absent, report that limitation.\n- Ask one concise clarification when required target context is missing or ambiguous.\n`;
}

export function renderRouterSkill(version) {
  const rows = DOMAIN_SKILLS.map(
    (domain) => `| \`${domain.name}\` | ${domain.description} |`
  ).join('\n');
  return `${renderFrontmatter(ROUTER_SKILL)}\n\n# ${ROUTER_SKILL.title}\n\nUse this router to select the smallest RealTimeX skill that owns the requested operation. Load more than one focused skill only when the request crosses domains.\n\n${renderSharedUsage(version)}\n\n## Skill routing\n\n| Skill | Use for |\n| --- | --- |\n${rows}\n\n## Cross-domain requests\n\n1. Resolve the current workspace or thread with \`prepare --agent\` when needed.\n2. Execute read/discovery operations before dependent mutations.\n3. Pass exact server-returned identifiers between focused skills.\n4. Keep destructive actions explicit and confirm the target before execution.\n\nThe focused skills contain the command references and domain-specific safety rules. This router intentionally does not duplicate their full command inventory.\n`;
}
