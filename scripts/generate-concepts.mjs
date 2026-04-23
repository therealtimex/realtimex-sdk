#!/usr/bin/env node
/**
 * generate-concepts.mjs
 *
 * Auto-generates app-concepts.md from the RealtimeX app source code.
 *
 * Sources extracted:
 *   - server/prisma/schema.prisma        → Data model glossary
 *   - server/utils/files/personalityStorage.js → Personality file structure
 *   - server/models/heartbeat.js         → Heartbeat config
 *   - server/models/workspace.js         → Workspace types & settings
 *   - server/models/agentSkills.js       → Skill types & scopes
 *
 * Usage:
 *   node scripts/generate-concepts.mjs
 *   node scripts/generate-concepts.mjs --app-root=../realtimex-ai-app
 *   node scripts/generate-concepts.mjs --out=path/to/output.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_ROOT   = path.resolve(__dirname, '..');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);

const APP_ROOT  = path.resolve(SDK_ROOT, args['app-root'] ?? '../realtimex-ai-app');
const OUT_FILE  = args.out
  ? path.resolve(args.out)
  : path.join(SDK_ROOT, 'typescript/skills/realtimex-moderator-sdk/references/app-concepts.md');

// ── Helpers ─────────────────────────────────────────────────────────────────
function readFile(relPath) {
  const abs = path.join(APP_ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf-8');
}

function log(msg) { process.stdout.write(msg + '\n'); }

// ── 1. Prisma schema parser ─────────────────────────────────────────────────
// Extracts key models (skip junction/audit tables) with field definitions.

const SKIP_MODELS = new Set([
  'password_reset_tokens', 'recovery_codes', 'document_vectors',
  'welcome_messages', 'prompt_history', 'webhook_data',
  'document_sync_queues', 'workspace_suggested_messages',
  'workspace_parsed_files', 'session_tokens', 'temporary_auth_tokens',
]);

// Human-readable names and descriptions for important models
const MODEL_META = {
  workspaces:                  { name: 'Workspace',           desc: 'A chat/knowledge space with its own documents, LLM config, and agent settings.' },
  workspace_threads:           { name: 'Thread',              desc: 'A conversation thread within a workspace. Can represent a meeting or a standalone chat.' },
  workspace_documents:         { name: 'WorkspaceDocument',   desc: 'A document embedded into a workspace\'s vector store for RAG.' },
  users:                       { name: 'User',                desc: 'A platform user account.' },
  embed_configs:               { name: 'EmbedConfig',         desc: 'Configuration for an embeddable chat widget hosted on an external site.' },
  agent_skills:                { name: 'AgentSkill',          desc: 'A skill (tool-set) available to agents. Can come from a git repo, zip file, or plugin.' },
  agent_flows:                 { name: 'AgentFlow',           desc: 'An automated multi-step agent workflow.' },
  local_apps:                  { name: 'LocalApp',            desc: 'A registered SDK application with scoped permissions (x-app-id auth).' },
  workspace_agent_invocations: { name: 'AgentInvocation',     desc: 'A single agent task invocation with lifecycle state tracking.' },
  heartbeat_queue:             { name: 'HeartbeatQueue',      desc: 'Queue of text items consumed by the ambient heartbeat agent.' },
  workspace_configs:           { name: 'WorkspaceConfig',     desc: 'Key-value config bag attached to a workspace (defaultAgent, etc.).' },
  workspace_memories:          { name: 'WorkspaceMemory',     desc: 'A long-term memory entry stored for a workspace.' },
  calendar_events:             { name: 'CalendarEvent',       desc: 'A calendar event linked to a workspace thread (meeting integration).' },
  channel_plugins:             { name: 'ChannelPlugin',       desc: 'A messaging channel integration (e.g. Slack, Teams) linked to a workspace.' },
  plugins:                     { name: 'Plugin',              desc: 'An installable plugin that extends RealtimeX with new providers, skills, or channels.' },
  agentic_clis:                { name: 'AgenticCLI',          desc: 'A registered CLI tool (e.g. Claude, Gemini) that agents can invoke.' },
  api_keys:                    { name: 'ApiKey',              desc: 'A Bearer API key for authenticating v1 API and SDK requests.' },
  workspace_tasks:             { name: 'WorkspaceTask',       desc: 'A discrete task created within a workspace.' },
};

function parsePrismaSchema(src) {
  const models = [];
  let current = null;

  for (const raw of src.split('\n')) {
    const line = raw.trim();

    if (line.startsWith('model ') && line.endsWith('{')) {
      const modelName = line.slice(6, -1).trim();
      current = { name: modelName, fields: [] };
      continue;
    }

    if (line === '}' && current) {
      models.push(current);
      current = null;
      continue;
    }

    if (!current) continue;
    if (!line || line.startsWith('//') || line.startsWith('@') ||
        line.startsWith('@@') || line.startsWith('///')) continue;

    // Parse field: name  Type  @attrs  // inline comment
    const match = line.match(/^(\w+)\s+(\S+)(.*?)(?:\/\/\s*(.+))?$/);
    if (!match) continue;
    const [, fieldName, fieldType, attrs, comment] = match;

    // Extract @default value
    const defaultMatch = attrs.match(/@default\(([^)]+)\)/);
    const defaultVal = defaultMatch ? defaultMatch[1].replace(/"/g, '') : null;

    // Skip internal/system fields
    if (['id', 'createdAt', 'lastUpdatedAt', 'createdBy', 'updatedAt'].includes(fieldName)) continue;

    current.fields.push({
      name: fieldName,
      type: fieldType.replace('?', ''),
      optional: fieldType.includes('?'),
      default: defaultVal,
      comment: comment?.trim() ?? null,
    });
  }

  return models;
}

function renderPrismaSection(src) {
  const allModels = parsePrismaSchema(src);
  const lines = [
    '## Data Models\n',
    'The following models are stored in the RealtimeX database (Prisma / SQLite or PostgreSQL).\n',
  ];

  for (const model of allModels) {
    if (SKIP_MODELS.has(model.name)) continue;
    const meta = MODEL_META[model.name];
    const displayName = meta?.name ?? model.name;
    const desc = meta?.desc ?? '';

    lines.push(`### ${displayName} (\`${model.name}\`)`);
    if (desc) lines.push(`${desc}\n`);

    if (model.fields.length > 0) {
      lines.push('| Field | Type | Default | Notes |');
      lines.push('|---|---|---|---|');
      for (const f of model.fields) {
        const type  = `${f.type}${f.optional ? '?' : ''}`;
        const def   = f.default ?? '—';
        const notes = f.comment ?? '—';
        lines.push(`| \`${f.name}\` | ${type} | ${def} | ${notes} |`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── 2. Personality file structure ────────────────────────────────────────────
function renderPersonalitySection(src) {
  // Extract the top-level JSDoc block (lines between /** and */)
  const jsdocMatch = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!jsdocMatch) return null;

  const docLines = jsdocMatch[1]
    .split('\n')
    .map(l => l.replace(/^\s*\*\s?/, '').trimEnd())
    .filter(l => l !== undefined);

  // Pull out the file list lines (lines with " — ")
  const fileLines = docLines.filter(l => /^\s+\w+\.\w+\s+—/.test(l) || /^\s+\w+\/\s+—/.test(l));

  const lines = [
    '## Personality\n',
    'The **Personality** system stores per-agent and per-workspace configuration as markdown files.',
    'Files live in `storage/working-data/agent-heartbeat/` (global) or `storage/working-data/<workspace-slug>/` (workspace-level).\n',
    '### File Structure\n',
    '| File | Purpose |',
    '|---|---|',
  ];

  for (const fl of fileLines) {
    const m = fl.trim().match(/^(\S+)\s+—\s+(.+)$/);
    if (m) lines.push(`| \`${m[1]}\` | ${m[2]} |`);
  }

  lines.push('');
  lines.push('Personality files are editable via the Personality editor in the UI or directly through the `/api/personality-files` endpoints.\n');

  return lines.join('\n');
}

// ── 3. Heartbeat config ──────────────────────────────────────────────────────
function renderHeartbeatSection(src) {
  // Extract the JSDoc above DEFAULT_HEARTBEAT_CONFIG
  const jsdocMatch = src.match(/\/\*\*\s*\n\s*\*\s*Default heartbeat configuration[\s\S]*?\*\//);

  // Extract DEFAULT_HEARTBEAT_CONFIG object
  const configMatch = src.match(/const DEFAULT_HEARTBEAT_CONFIG\s*=\s*\{([\s\S]*?)\n\};/);

  const lines = [
    '## Heartbeat\n',
    '**Heartbeat** is the ambient background agent system. It runs an AI agent on a schedule to proactively',
    'monitor context (calendar, documents, threads) and take autonomous actions.\n',
    '### How It Works\n',
    '1. A scheduler triggers runs based on `every` cadence (e.g. `"30m"`, `"1h"`).',
    '2. Each run provisions an agent (default: RealTimeX Ambient Agent based on Qwen CLI).',
    '3. The agent reads Personality files, the heartbeat queue, and calendar events.',
    '4. Results are stored in the week\'s thread inside the `agent_heartbeat` workspace.\n',
    '### Configuration (`heartbeat_config` in system_settings)\n',
    '| Field | Default | Description |',
    '|---|---|---|',
  ];

  if (configMatch) {
    const body = configMatch[1];
    // Parse only top-level scalar fields: `  fieldName: value,  // comment`
    const fieldPattern = /^\s{2}(\w+):\s*([^{\n,]+?),?\s*(?:\/\/\s*(.+))?$/gm;
    let match;
    while ((match = fieldPattern.exec(body)) !== null) {
      const [, field, rawVal, comment] = match;
      if (['agent', 'calendarRoutines'].includes(field)) continue;
      const defVal = rawVal.trim();
      lines.push(`| \`${field}\` | \`${defVal}\` | ${comment?.trim() ?? '—'} |`);
    }
  }

  lines.push('');
  lines.push('### Calendar Routines\n');
  lines.push('Heartbeat can integrate with calendar events via these routines:');
  lines.push('- **`morningBrief`** — Runs at start of day to summarize upcoming meetings');
  lines.push('- **`preMeetingPrep`** — Runs before a meeting to prepare context');
  lines.push('- **`followUpSuggestions`** — Runs after a meeting to suggest follow-up actions\n');

  lines.push('### Heartbeat Queue\n');
  lines.push('The `heartbeat_queue` table stores text items (documents, messages, events) that the agent consumes on the next run. Items are drained after consumption.\n');

  return lines.join('\n');
}

// ── 4. Workspace concepts ────────────────────────────────────────────────────
function renderWorkspaceSection(src) {
  // Extract workspace types
  const typesMatch = src.match(/const validTypes\s*=\s*\[([\s\S]*?)\]/);
  const types = typesMatch
    ? typesMatch[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) ?? []
    : [];

  // Extract chatMode values
  const chatModeMatch = src.match(/\["chat",\s*"query"\]/);

  // Extract webSearchProvider values
  const wsProviderMatch = src.match(/const validProviders\s*=\s*\[([\s\S]*?)\]/);
  const wsProviders = wsProviderMatch
    ? wsProviderMatch[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) ?? []
    : [];

  const TYPE_DESCRIPTIONS = {
    default:          'Standard RAG chat workspace with documents and LLM',
    meeting_minutes:  'Workspace focused on meeting recording and transcription',
    agent_skills:     'Workspace used to host and develop agent skills',
    agent_heartbeat:  'Special system workspace for the ambient heartbeat agent',
  };

  const lines = [
    '## Workspace\n',
    'A **Workspace** is the core unit of organisation in RealtimeX. It combines a document store (vector DB),',
    'LLM configuration, agent settings, and a chat interface.\n',
    '### Workspace Types\n',
    '| Type | Description |',
    '|---|---|',
  ];

  for (const t of types) {
    lines.push(`| \`${t}\` | ${TYPE_DESCRIPTIONS[t] ?? '—'} |`);
  }

  lines.push('');
  lines.push('### Chat Modes\n');
  lines.push('| Mode | Description |');
  lines.push('|---|---|');
  lines.push('| `chat` | Full conversational mode — uses document context + LLM history |');
  lines.push('| `query` | Query-only mode — each message is independent, no history |');

  lines.push('');
  lines.push('### Web Search Providers\n');
  if (wsProviders.length) {
    lines.push(`Available values for \`webSearchProvider\`: ${wsProviders.map(p => `\`${p}\``).join(', ')}\n`);
  }

  lines.push('### Key Settings\n');
  lines.push('| Setting | Description |');
  lines.push('|---|---|');
  lines.push('| `openAiPrompt` | System prompt sent to the LLM |');
  lines.push('| `chatProvider` / `chatModel` | LLM provider and model for chat |');
  lines.push('| `similarityThreshold` | Minimum similarity score for document retrieval (0–1, default 0.25) |');
  lines.push('| `topN` | Number of document chunks to retrieve per query (default 4) |');
  lines.push('| `vectorSearchMode` | `default` or `rerank` |');
  lines.push('| `webSearchEnabled` | Whether to augment responses with live web search |');
  lines.push('| `ambientAgentProvider` / `ambientAgentModel` | Override LLM for ambient agent in this workspace |');
  lines.push('| `ambientAgentSystemPrompt` | Custom system prompt for the ambient agent in this workspace |\n');

  return lines.join('\n');
}

// ── 5. Agent Skills ──────────────────────────────────────────────────────────
function renderSkillsSection(src) {
  const typesMatch    = src.match(/VALID_TYPES:\s*\[([\s\S]*?)\]/);
  const scopesMatch   = src.match(/VALID_SCOPES:\s*\[([\s\S]*?)\]/);
  const statusMatch   = src.match(/VALID_STATUS_VALUES:\s*\[([\s\S]*?)\]/);

  const extract = match => match
    ? (match[1].match(/"([^"]+)"/g) ?? []).map(s => s.replace(/"/g, ''))
    : [];

  const types   = extract(typesMatch);
  const scopes  = extract(scopesMatch);
  const statuses = extract(statusMatch);

  const TYPE_DESC  = { repo: 'Skill loaded from a git repository URL', zip: 'Skill loaded from an uploaded .zip file' };
  const SCOPE_DESC = {
    global:      'Available to all workspaces and users',
    workspace:   'Scoped to a specific workspace',
    'local-app': 'Provided by a registered LocalApp (SDK)',
    uploaded:    'Manually uploaded by a user',
    plugin:      'Bundled with an installed plugin (read-only)',
  };

  const lines = [
    '## Agent Skills\n',
    'An **Agent Skill** is a tool-set (a `SKILL.md` + scripts folder) that agents can invoke.',
    'Skills are loaded from git repositories, zip files, or installed plugins.\n',
    '### Skill Types\n',
    '| Type | Description |',
    '|---|---|',
  ];
  for (const t of types) lines.push(`| \`${t}\` | ${TYPE_DESC[t] ?? '—'} |`);

  lines.push('');
  lines.push('### Skill Scopes\n');
  lines.push('| Scope | Description |');
  lines.push('|---|---|');
  for (const s of scopes) lines.push(`| \`${s}\` | ${SCOPE_DESC[s] ?? '—'} |`);

  lines.push('');
  lines.push('### Skill Status\n');
  lines.push(`Valid values: ${statuses.map(s => `\`${s}\``).join(', ')}\n`);

  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────
function generate() {
  log(`Generating app-concepts.md from ${APP_ROOT}`);

  const sections = [
    `# RealtimeX App Concepts\n`,
    `> Auto-generated from app source code. Do not edit manually.\n`,
    `> Sources: Prisma schema, model files, personalityStorage.js\n`,
  ];

  // Personality
  const personalitySrc = readFile('server/utils/files/personalityStorage.js');
  if (personalitySrc) {
    const s = renderPersonalitySection(personalitySrc);
    if (s) { sections.push(s); log('  ✓ Personality'); }
  } else { log('  ⚠ personalityStorage.js not found — skipping'); }

  // Heartbeat
  const heartbeatSrc = readFile('server/models/heartbeat.js');
  if (heartbeatSrc) {
    sections.push(renderHeartbeatSection(heartbeatSrc));
    log('  ✓ Heartbeat');
  } else { log('  ⚠ heartbeat.js not found — skipping'); }

  // Workspace
  const workspaceSrc = readFile('server/models/workspace.js');
  if (workspaceSrc) {
    sections.push(renderWorkspaceSection(workspaceSrc));
    log('  ✓ Workspace');
  } else { log('  ⚠ workspace.js not found — skipping'); }

  // Agent Skills
  const skillsSrc = readFile('server/models/agentSkills.js');
  if (skillsSrc) {
    sections.push(renderSkillsSection(skillsSrc));
    log('  ✓ Agent Skills');
  } else { log('  ⚠ agentSkills.js not found — skipping'); }

  // Prisma schema
  const prismaSrc = readFile('server/prisma/schema.prisma');
  if (prismaSrc) {
    sections.push(renderPrismaSection(prismaSrc));
    log('  ✓ Prisma schema');
  } else { log('  ⚠ schema.prisma not found — skipping'); }

  const output = sections.join('\n---\n\n');
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, output, 'utf-8');
  log(`\nWrote ${(output.length / 1024).toFixed(1)} KB → ${OUT_FILE}`);
}

generate();
