#!/usr/bin/env node
/**
 * generate-skill.mjs
 *
 * Generates (or updates) the realtimex-moderator-sdk Qwen skill directly
 * from TypeScript source — zero LLMs, zero npm install, zero extra deps.
 *
 * Uses pure regex + brace-counting to parse .ts files:
 *   1. Extracts exported classes → public methods (name, params, return, JSDoc)
 *   2. Extracts exported interfaces that appear in method signatures
 *   3. Scans specific patterns to detect known API mismatches
 *   4. Writes SKILL.md, references/api-reference.md, references/known-issues.md
 *
 * Usage:
 *   node scripts/generate-skill.mjs [options]
 *
 * Options:
 *   --out <dir>      Output skill directory (default: see DEFAULT_OUT below)
 *   --dry-run        Print what would be generated, write nothing
 *   --force          Overwrite SKILL.md even if it already exists
 *
 * Re-run whenever the SDK source changes to keep the skill up to date.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TS_SRC    = path.join(REPO_ROOT, 'typescript', 'src');
const TS_PKG    = path.join(REPO_ROOT, 'typescript', 'package.json');

const DEFAULT_OUT = path.join(REPO_ROOT, 'typescript', 'skills', 'realtimex-moderator-sdk');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const [k, ...rest] = argv[i].slice(2).split('=');
    flags[k] = rest.length
      ? rest.join('=')
      : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return flags;
}
const flags   = parseFlags(process.argv.slice(2));
const OUT_DIR = path.resolve(flags.out || DEFAULT_OUT);
const DRY_RUN = flags['dry-run'] === true || flags['dry-run'] === 'true';
const FORCE   = flags.force === true || flags.force === 'true';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Extract the text of a JSDoc block that ends just before `pos` in `src`. */
function jsDocBefore(src, pos) {
  const snippet = src.slice(Math.max(0, pos - 600), pos);
  const m = snippet.match(/\/\*\*([\s\S]*?)\*\/\s*(?:\/\/[^\n]*)?\s*$/);
  if (!m) return '';
  return m[1]
    .split('\n')
    .map(l => l.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim()
    .split('\n')[0];   // first sentence only
}

/**
 * Find the matching closing brace for the opening `{` at index `openIdx` in `src`.
 * Returns the index AFTER the closing `}`, or -1 if not found.
 */
function findClosingBrace(src, openIdx) {
  let depth = 0;
  let inStr = false;
  let strChar = '';
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    const prev = i > 0 ? src[i - 1] : '';
    if (inLineComment)  { if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (ch === '/' && prev === '*') inBlockComment = false; continue; }
    if (inStr) {
      if (ch === strChar && prev !== '\\') inStr = false;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') { inLineComment = true; continue; }
    if (ch === '/' && src[i + 1] === '*') { inBlockComment = true; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strChar = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Collapse whitespace and newlines in a signature to a single line. */
function cleanSig(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/** Strip block/line comments from text (used for signature cleaning). */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

// ---------------------------------------------------------------------------
// TypeScript source parser (pure text)
// ---------------------------------------------------------------------------

/**
 * Parse a single .ts source file.
 * Returns: { classes, interfaces, typeAliases, constants }
 */
function parseFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf-8');
  const classes    = [];
  const interfaces = [];
  const typeAliases = [];
  const constants  = [];

  // ── Extract exported interfaces ──────────────────────────────────────────
  const ifaceRegex = /export\s+interface\s+(\w+)(?:\s+extends[^{]*)?\s*\{/g;
  let im;
  while ((im = ifaceRegex.exec(src)) !== null) {
    const name  = im[1];
    const bodyStart = im.index + im[0].length - 1;   // points to '{'
    const bodyEnd = findClosingBrace(src, bodyStart);
    const body    = bodyEnd > 0 ? src.slice(bodyStart + 1, bodyEnd - 1) : '';
    const jsDoc   = jsDocBefore(src, im.index);

    // Extract member lines (name?: type)
    const members = [];
    for (const line of body.split('\n')) {
      const clean = line.replace(/\/\/.*/, '').trim();
      if (!clean || clean.startsWith('*') || clean.startsWith('/*')) continue;
      // match property or method signature
      const mp = clean.match(/^(?:readonly\s+)?(\w+)\??\s*(?::\s*([^;,]+))?[;,]?$/);
      if (mp) members.push(clean.replace(/[;,]$/, ''));
    }
    interfaces.push({ name, jsDoc, members });
  }

  // ── Extract exported type aliases ────────────────────────────────────────
  const typeAliasRegex = /export\s+type\s+(\w+)\s*=\s*([^;]+);/g;
  let ta;
  while ((ta = typeAliasRegex.exec(src)) !== null) {
    typeAliases.push({
      name: ta[1],
      rhs: cleanSig(ta[2]).slice(0, 200),
    });
  }

  // ── Extract exported constants ───────────────────────────────────────────
  const constRegex = /export\s+const\s+(\w+)\s*=\s*([^;]+);/g;
  let cm;
  while ((cm = constRegex.exec(src)) !== null) {
    constants.push({ name: cm[1], value: cleanSig(cm[2]).slice(0, 120) });
  }

  // ── Extract exported classes ─────────────────────────────────────────────
  const classRegex = /export\s+(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+([\w<>]+))?(?:\s+implements[^{]*)?\s*\{/g;
  let km;
  while ((km = classRegex.exec(src)) !== null) {
    const className   = km[1];
    const extendsName = km[2] ? km[2].replace(/<.*>/, '') : null;
    const classJsDoc  = jsDocBefore(src, km.index);
    const braceIdx    = km.index + km[0].length - 1;
    const classEnd    = findClosingBrace(src, braceIdx);
    const classBody   = classEnd > 0 ? src.slice(braceIdx + 1, classEnd - 1) : '';

    const methods = [];
    const props   = [];

    // Extract public properties (e.g. `public vectors: VectorStore`)
    const propRe = /(?:^|\n)\s*public\s+(?:readonly\s+)?(\w+)\s*:\s*([^;=\n]+)/g;
    let pm;
    while ((pm = propRe.exec(classBody)) !== null) {
      const propName = pm[1];
      const propType = pm[2].trim();
      const readonly = /readonly/.test(pm[0]);
      props.push({ name: propName, type: propType, readonly });
    }

    // Extract method declarations
    // Covers:
    //   async methodName(...)
    //   async *methodName(...)
    //   methodName(...)
    //   public async methodName(...)
    // but NOT: private/protected, constructor (usually irrelevant)
    const methodRe = /(?:^|\n)([ \t]*)(\/\*\*[\s\S]*?\*\/\s*)?((?:public\s+)?(?:static\s+)?(?:async\s+)?(?:\*\s*)?(\w+)\s*(?:<[^(]+>)?\s*\()/g;
    let mm;
    while ((mm = methodRe.exec(classBody)) !== null) {
      const indent   = mm[1];
      const docBlock = mm[2] || '';
      const sigStart = mm[3];
      const methodName = mm[4];

      // Skip private/protected/constructor/internal
      if (/^(private|protected|constructor|#)/.test(sigStart.trim())) continue;
      if (/\s(private|protected)\s/.test(sigStart)) continue;
      // Skip property assignments
      if (methodName === 'if' || methodName === 'for' || methodName === 'while' ||
          methodName === 'switch' || methodName === 'return' || methodName === 'throw') continue;
      // Skip class-level arrow function assignments (not method declarations)
      // A method declaration won't have '= ' before the name
      const preContext = classBody.slice(Math.max(0, mm.index - 20), mm.index);
      if (/=\s*$/.test(preContext)) continue;

      // Extract JSDoc summary from inline block or search before
      let jsDoc = '';
      if (docBlock) {
        jsDoc = docBlock
          .replace(/\/\*\*|\*\//g, '')
          .split('\n')
          .map(l => l.replace(/^\s*\*\s?/, '').trim())
          .filter(Boolean)[0] || '';
      }

      // Find the opening `(` position in classBody
      const parenOpenAbsIdx = mm.index + mm[0].length - 1;

      // Collect parameters by finding balanced parens
      let depth = 0;
      let paramsEnd = parenOpenAbsIdx;
      for (let i = parenOpenAbsIdx; i < classBody.length; i++) {
        if (classBody[i] === '(') depth++;
        else if (classBody[i] === ')') {
          depth--;
          if (depth === 0) { paramsEnd = i; break; }
        }
      }
      const rawParams = classBody.slice(parenOpenAbsIdx + 1, paramsEnd);
      const params = cleanSig(stripComments(rawParams));

      // Return type: everything between ): and {|;
      const afterParen = classBody.slice(paramsEnd + 1);
      const retMatch = afterParen.match(/^\s*:\s*([\s\S]+?)(?=\s*(?:\{|;|$))/);
      const returnType = retMatch ? cleanSig(stripComments(retMatch[1])) : 'void';

      const isAsync = /\basync\b/.test(sigStart);
      const isGen   = /\*/.test(sigStart) || /AsyncGenerator|AsyncIterableIterator|AsyncIterable/.test(returnType);
      const isStat  = /\bstatic\b/.test(sigStart);

      methods.push({
        name: methodName,
        async: isAsync,
        generator: isGen,
        static: isStat,
        params,
        returnType,
        jsDoc,
      });
    }

    classes.push({
      name: className,
      jsDoc: classJsDoc,
      extends: extendsName,
      methods,
      props,
    });
  }

  return { classes, interfaces, typeAliases, constants };
}

// ---------------------------------------------------------------------------
// Known-issue detectors — pure regex on source text
// ---------------------------------------------------------------------------

function detectKnownIssues(srcDir) {
  function read(rel) {
    const fp = path.join(srcDir, rel);
    return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
  }

  const issues = [];

  // ── 1. webhook.triggerAgent sends 'task.trigger' not 'trigger-agent' ──
  const webhook = read('modules/webhook.ts');
  const issue1 = /event:\s*['"]task\.trigger['"]/.test(webhook);
  issues.push({
    id: 1, file: 'modules/webhook.ts',
    title: '`sdk.webhook.triggerAgent()` sends `event: "task.trigger"` — server expects `"trigger-agent"`',
    detected: issue1,
    evidence: issue1
      ? 'Found `event: "task.trigger"` hardcoded in triggerAgent() body (line ~100)'
      : 'Pattern not found',
    fix: `// ❌ WRONG — SDK sends 'task.trigger' but server enum only accepts 'trigger-agent'
await sdk.webhook.triggerAgent({ auto_run: true, agent_name: 'agent', ... });

// ✅ CORRECT — raw fetch with server-expected event string
const resp = await fetch('http://localhost:3001/webhooks/realtimex', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${apiKey}\` },
  body: JSON.stringify({
    event: 'trigger-agent',
    payload: { auto_run: true, agent_name: 'document2speech', workspace_slug: 'sdfsdf', prompt: '...' },
  }),
});`,
  });

  // ── 2. task methods are positional (taskUuid, result?, opts?) ──
  const task = read('modules/task.ts');
  const taskOk = /async start\(\s*taskUuid:\s*string/.test(task)
              && /async complete\(\s*taskUuid:\s*string[\s\S]{0,60}result/.test(task)
              && /async fail\(\s*taskUuid:\s*string[\s\S]{0,60}error:\s*string/.test(task);
  issues.push({
    id: 2, file: 'modules/task.ts',
    title: '`sdk.task.start/complete/fail` take positional `(taskUuid, ...)` — NOT `{ task_uuid }` object',
    detected: taskOk,
    evidence: taskOk ? 'start(taskUuid: string, ...) | complete(taskUuid, result, ...) | fail(taskUuid, error: string, ...)' : 'Pattern not found',
    fix: `// ❌ WRONG
await sdk.task.start({ task_uuid: uuid });
await sdk.task.complete({ task_uuid: uuid, result: { out: 'done' } });

// ✅ CORRECT
await sdk.task.start(uuid);
await sdk.task.complete(uuid, { out: 'done' });
await sdk.task.fail(uuid, 'error message');
await sdk.task.start(uuid, { machineId: 'machine-01' });`,
  });

  // ── 3. activities.list() returns Activity[] directly ──
  const acts = read('modules/activities.ts');
  const actsOk = /async list[\s\S]{0,300}Promise<Activity\[\]>/.test(acts);
  issues.push({
    id: 3, file: 'modules/activities.ts',
    title: '`sdk.activities.list()` returns `Activity[]` directly — NOT `{ activities: [...] }`',
    detected: actsOk,
    evidence: actsOk ? 'Return type is Promise<Activity[]>' : 'Pattern not found',
    fix: `// ❌ WRONG
const { activities } = await sdk.activities.list();

// ✅ CORRECT
const activities = await sdk.activities.list();
for (const a of activities) { ... }`,
  });

  // ── 4. llm.chat response is res.response?.content ──
  const llm = read('modules/llm.ts');
  const chatRespOk = /interface ChatResponse[\s\S]{0,300}response\?:\s*\{/.test(llm);
  issues.push({
    id: 4, file: 'modules/llm.ts',
    title: '`sdk.llm.chat()` response is `res.response?.content` — NOT `choices[0].message.content`',
    detected: chatRespOk,
    evidence: chatRespOk ? 'ChatResponse shape: { success, response?: { content, model, metrics } }' : 'Pattern not found',
    fix: `// ❌ WRONG (OpenAI style)
console.log(res.choices[0].message.content);

// ✅ CORRECT
const res = await sdk.llm.chat([{ role: 'user', content: 'Hello' }]);
console.log(res.response?.content);`,
  });

  // ── 5. chatStream yields chunk.textResponse ──
  const streamOk = /textResponse\?:\s*string/.test(llm);
  issues.push({
    id: 5, file: 'modules/llm.ts',
    title: '`sdk.llm.chatStream()` yields `chunk.textResponse` — NOT `choices[0].delta.content`',
    detected: streamOk,
    evidence: streamOk ? 'StreamChunk interface has textResponse?: string' : 'Pattern not found',
    fix: `// ❌ WRONG
chunk.choices?.[0]?.delta?.content

// ✅ CORRECT
for await (const chunk of sdk.llm.chatStream(messages)) {
  if (chunk.textResponse) process.stdout.write(chunk.textResponse);
  if (chunk.close) break;
}`,
  });

  // ── 6. embedAndStore takes a params object with texts: string[] ──
  const embedStoreOk = /async embedAndStore\(params:\s*\{/.test(llm);
  issues.push({
    id: 6, file: 'modules/llm.ts',
    title: '`sdk.llm.embedAndStore()` takes `{ texts: string[], documentId?, workspaceId?, ... }` — NOT `(text, options)`',
    detected: embedStoreOk,
    evidence: embedStoreOk ? 'embedAndStore(params: { texts: string[]; documentId?; workspaceId?; ... })' : 'Pattern not found',
    fix: `// ❌ WRONG
await sdk.llm.embedAndStore('text content', { id: 'doc-1' });

// ✅ CORRECT
await sdk.llm.embedAndStore({ texts: ['chunk 1', 'chunk 2'], documentId: 'doc-1', workspaceId: 'ws-123' });`,
  });

  // ── 7. vectors.query takes number[] not string ──
  const vqOk = /async query\(vector:\s*number\[\]/.test(llm);
  issues.push({
    id: 7, file: 'modules/llm.ts',
    title: '`sdk.llm.vectors.query()` takes a raw `number[]` embedding — NOT a text string',
    detected: vqOk,
    evidence: vqOk ? 'query(vector: number[], options?)' : 'Pattern not found',
    fix: `// ❌ WRONG
await sdk.llm.vectors.query('search text');

// ✅ CORRECT — raw vector
const { embeddings } = await sdk.llm.embed('search text');
await sdk.llm.vectors.query(embeddings[0], { topK: 5 });

// ✅ EASIER — high-level helper
const hits = await sdk.llm.search('search text', { topK: 5 });`,
  });

  // ── 8. vectors.delete requires { deleteAll: true } ──
  const vdOk = /interface VectorDeleteOptions[\s\S]{0,200}deleteAll:\s*true/.test(llm);
  issues.push({
    id: 8, file: 'modules/llm.ts',
    title: '`sdk.llm.vectors.delete()` requires `{ deleteAll: true }` — delete-by-ID not supported',
    detected: vdOk,
    evidence: vdOk ? 'VectorDeleteOptions: { workspaceId?, deleteAll: true } (literal true)' : 'Pattern not found',
    fix: `// ❌ WRONG
await sdk.llm.vectors.delete(['id-1', 'id-2']);

// ✅ CORRECT
await sdk.llm.vectors.delete({ deleteAll: true, workspaceId: 'ws-123' });`,
  });

  // ── 9. mcp.getServers takes plain string not object ──
  const mcp = read('modules/mcp.ts');
  const mcpOk = /async getServers\(provider[^)]*=\s*['"]all['"]/.test(mcp);
  issues.push({
    id: 9, file: 'modules/mcp.ts',
    title: '`sdk.mcp.getServers()` takes a plain string — NOT `{ provider: "all" }`',
    detected: mcpOk,
    evidence: mcpOk ? "getServers(provider: 'local' | 'remote' | 'all' = 'all')" : 'Pattern not found',
    fix: `// ❌ WRONG
await sdk.mcp.getServers({ provider: 'all' });

// ✅ CORRECT
await sdk.mcp.getServers('all');
await sdk.mcp.getServers();     // defaults to 'all'`,
  });

  // ── 10. metadata methods on sdk.api not sdk ──
  const index = read('index.ts');
  const apiOk = /this\.api\s*=\s*new ApiModule/.test(index);
  issues.push({
    id: 10, file: 'index.ts',
    title: '`getAgents/getWorkspaces/getThreads/getTask` live on `sdk.api.*` — NOT directly on `sdk.*`',
    detected: apiOk,
    evidence: apiOk ? 'this.api = new ApiModule(...) — separate sub-module in constructor' : 'Pattern not found',
    fix: `// ❌ WRONG
await sdk.getAgents();
await sdk.getWorkspaces();

// ✅ CORRECT
await sdk.api.getAgents();
await sdk.api.getWorkspaces();
await sdk.api.getThreads('workspace-slug');
await sdk.api.getTask('task-uuid');`,
  });

  // ── 11. ACP streamChat uses named SSE events ──
  const acp = read('modules/acpAgent.ts');
  const acpSSE = /parseNamedSSEStream/.test(acp) && /text_delta/.test(acp);
  issues.push({
    id: 11, file: 'modules/acpAgent.ts',
    title: 'ACP `streamChat` uses named SSE (`event:` line); `text_delta.data.type === "thinking"` = internal reasoning',
    detected: acpSSE,
    evidence: acpSSE ? 'Uses parseNamedSSEStream() — reads both event: and data: SSE lines per spec' : 'Pattern not found',
    fix: `for await (const event of sdk.acpAgent.streamChat(key, message)) {
  if (event.type === 'text_delta') {
    if (event.data.type !== 'thinking') {   // skip internal reasoning
      process.stdout.write(String(event.data.text ?? ''));
    }
  }
}`,
  });

  // ── 12. ACP needs approvalPolicy ──
  const acpPolicy = /approvalPolicy\?:\s*['"]approve-all['"]/.test(acp);
  issues.push({
    id: 12, file: 'modules/acpAgent.ts',
    title: 'ACP sessions stall without `approvalPolicy: "approve-all"` when tools need permission',
    detected: acpPolicy,
    evidence: acpPolicy ? "AcpSessionOptions.approvalPolicy?: 'approve-all' | 'approve-reads' | 'deny-all'" : 'Pattern not found',
    fix: `// ✅ Always set for autonomous scripts
await sdk.acpAgent.createSession({ agent_id: 'qwen', approvalPolicy: 'approve-all', cwd });`,
  });

  return issues;
}

// ---------------------------------------------------------------------------
// Module files to parse (order = display order in api-reference.md)
// ---------------------------------------------------------------------------
const MODULE_FILES = [
  // [relPath,               key,          group label]
  ['index.ts',               'sdk',         'Core — RealtimeXSDK'],
  ['modules/api.ts',         'api',         'sdk.api — Agents, Workspaces, Threads, Tasks'],
  ['modules/activities.ts',  'activities',  'sdk.activities — Activities CRUD'],
  ['modules/task.ts',        'task',        'sdk.task — Task Lifecycle Reporting'],
  ['modules/webhook.ts',     'webhook',     'sdk.webhook — Webhook Trigger'],
  ['modules/llm.ts',         'llm',         'sdk.llm — LLM Chat, Embed, Vector Search'],
  ['modules/mcp.ts',         'mcp',         'sdk.mcp — MCP Server Tools'],
  ['modules/acpAgent.ts',    'acpAgent',    'sdk.acpAgent — ACP CLI Agent Sessions'],
  ['modules/agent.ts',       'agent',       'sdk.agent — LLM Agent Sessions (REST/SSE)'],
  ['modules/tts.ts',         'tts',         'sdk.tts — Text-to-Speech'],
  ['modules/stt.ts',         'stt',         'sdk.stt — Speech-to-Text'],
  ['modules/contract.ts',    'contract',    'sdk.contract — Local App Contract'],
  ['modules/database.ts',    'database',    'sdk.database — Supabase Config'],
  ['modules/auth.ts',        'auth',        'sdk.auth — Auth Token'],
  ['modules/port.ts',        'port',        'sdk.port — Port Management'],
];

// Interfaces to surface in api-reference.md (others are internal)
const SURFACE_INTERFACES = new Set([
  'AcpSessionOptions', 'AcpSession', 'AcpSessionStatus', 'AcpStreamEvent',
  'AcpRuntimeOptionPatch', 'AcpPermissionDecision', 'AcpAttachment', 'AcpChatResponse',
  'TaskEventOptions', 'TaskStatusResponse',
  'ChatOptions', 'ChatResponse', 'StreamChunk', 'EmbedResponse', 'EmbedOptions',
  'VectorRecord', 'VectorQueryOptions', 'VectorQueryResult',
  'VectorUpsertOptions', 'VectorDeleteOptions', 'VectorListWorkspacesResponse',
  'MCPServer', 'MCPTool', 'MCPToolResult',
  'DatabaseConfig', 'AuthTokenResponse', 'SyncTokenResponse',
  'TriggerAgentPayload', 'TriggerAgentResponse',
  'Activity',
]);

// ---------------------------------------------------------------------------
// Markdown generators
// ---------------------------------------------------------------------------

function renderMethodSig(m) {
  const asyncKw = m.async && !m.generator ? 'async ' : '';
  const genKw   = m.generator ? 'async *' : '';
  const statKw  = m.static ? 'static ' : '';
  return `${statKw}${asyncKw}${genKw}${m.name}(${m.params}): ${m.returnType}`;
}

function generateApiReference(modules, pkgVersion) {
  const L = [];

  L.push(`# RealTimeX SDK — API Reference`);
  L.push(``);
  L.push(`> Auto-generated from \`@realtimex/sdk\` source · v**${pkgVersion}** · ${new Date().toISOString().slice(0,10)}`);
  L.push(``);
  L.push(`**Package:** \`@realtimex/sdk\` (CJS) · **Server:** \`http://localhost:3001\``);
  L.push(`**Developer Mode auth:** \`Authorization: Bearer <apiKey>\``);
  L.push(``);
  L.push(`---`);
  L.push(``);

  // Permissions table
  L.push(`## Available Permissions`);
  L.push(``);
  L.push(`| Permission | Grants access to |`);
  L.push(`|------------|------------------|`);
  for (const [p, d] of [
    ['api.agents',       '`sdk.api.getAgents()`'],
    ['api.workspaces',   '`sdk.api.getWorkspaces()`'],
    ['api.threads',      '`sdk.api.getThreads()`'],
    ['api.task',         '`sdk.api.getTask()`'],
    ['webhook.trigger',  'webhook trigger, task events'],
    ['activities.read',  '`sdk.activities.list/get()`'],
    ['activities.write', '`sdk.activities.insert/update/delete()`'],
    ['llm.chat',         '`sdk.llm.chat/chatStream()`'],
    ['llm.embed',        '`sdk.llm.embed()`'],
    ['llm.providers',    '`sdk.llm.chatProviders/embedProviders()`'],
    ['vectors.read',     '`sdk.llm.vectors.query/listWorkspaces()`'],
    ['vectors.write',    '`sdk.llm.vectors.upsert/delete()`'],
    ['tts.generate',     '`sdk.tts.speak/speakStream()`'],
    ['mcp.servers',      '`sdk.mcp.getServers()`'],
    ['mcp.tools',        '`sdk.mcp.getTools/executeTool()`'],
    ['acp.agent',        '`sdk.acpAgent.*`'],
  ]) L.push(`| \`${p}\` | ${d} |`);
  L.push(``);
  L.push(`---`);
  L.push(``);

  // Per-module sections
  for (const [, , group, data] of modules) {
    if (!data?.classes?.length && !data?.interfaces?.length) continue;

    L.push(`## ${group}`);
    L.push(``);

    for (const cls of data.classes) {
      // Skip internal helpers
      if (['ContractRuntime','ContractCache','ContractClient','RetryPolicy',
           'ScopeGuard','StaticAuthProvider','ToolProjector','ExecutionStore',
           'LifecycleReporter','LLMPermissionError','LLMProviderError',
           'PermissionDeniedError','PermissionRequiredError',
           'VectorStore'].includes(cls.name)) continue;

      L.push(`### \`${cls.name}\`${cls.extends ? ` *(extends ${cls.extends})*` : ''}`);
      L.push(``);
      if (cls.jsDoc) { L.push(`> ${cls.jsDoc}`); L.push(``); }

      // notable public props (exclude internals)
      const notableProps = cls.props.filter(p =>
        !['realtimexUrl','baseUrl','appId','appName','apiKey','httpClient',
          'callbackSecret','signCallbacksByDefault','permissions'].includes(p.name)
      );
      if (notableProps.length) {
        L.push(`**Public properties:**`);
        for (const p of notableProps)
          L.push(`- \`${p.readonly ? 'readonly ' : ''}${p.name}: ${p.type}\``);
        L.push(``);
      }

      if (cls.methods.length) {
        L.push('```ts');
        for (const m of cls.methods) {
          if (m.jsDoc) L.push(`// ${m.jsDoc}`);
          L.push(renderMethodSig(m));
          L.push('');
        }
        while (L[L.length-1] === '') L.pop();
        L.push('```');
      }
      L.push(``);
    }

    // VectorStore is notable — render it separately under the llm group
    if (group.includes('llm')) {
      const llmData = data;
      const vsClass = llmData?.classes?.find(c => c.name === 'VectorStore');
      if (vsClass) {
        L.push(`### \`VectorStore\` *(accessed as \`sdk.llm.vectors\`)*`);
        L.push(``);
        if (vsClass.methods.length) {
          L.push('```ts');
          for (const m of vsClass.methods) {
            if (m.jsDoc) L.push(`// ${m.jsDoc}`);
            L.push(renderMethodSig(m));
            L.push('');
          }
          while (L[L.length-1] === '') L.pop();
          L.push('```');
        }
        L.push(``);
      }
    }

    // Key interfaces
    for (const iface of (data.interfaces || [])) {
      if (!SURFACE_INTERFACES.has(iface.name)) continue;
      L.push(`#### \`${iface.name}\``);
      L.push(``);
      if (iface.jsDoc) { L.push(`> ${iface.jsDoc}`); L.push(``); }
      if (iface.members.length) {
        L.push('```ts');
        for (const m of iface.members) L.push(m);
        L.push('```');
        L.push(``);
      }
    }

    L.push(`---`);
    L.push(``);
  }

  return L.join('\n');
}

function generateKnownIssues(issues, pkgVersion) {
  const L = [];
  L.push(`# Known Issues — Source-Detected`);
  L.push(``);
  L.push(`> Auto-generated by \`scripts/generate-skill.mjs\` · SDK **${pkgVersion}** · ${new Date().toISOString().slice(0,10)}`);
  L.push(``);
  L.push(`Run \`node scripts/generate-skill.mjs --force\` after SDK source changes to refresh.`);
  L.push(``);
  const detected = issues.filter(i => i.detected).length;
  L.push(`**${detected}/${issues.length} issues confirmed in current source.**`);
  L.push(``);
  L.push(`---`);
  L.push(``);

  for (const issue of issues) {
    const badge = issue.detected ? '🔴 DETECTED' : '⚪ not detected';
    L.push(`## ${issue.id}. ${issue.title}`);
    L.push(``);
    L.push(`**Status:** ${badge}  `);
    L.push(`**File:** \`${issue.file}\`  `);
    L.push(`**Evidence:** \`${issue.evidence}\``);
    L.push(``);
    L.push(`**Correct usage:**`);
    L.push('```js');
    L.push(issue.fix);
    L.push('```');
    L.push(``);
    L.push(`---`);
    L.push(``);
  }

  return L.join('\n');
}

function generateSkillMd(modules, pkgVersion, issues) {
  const detected = issues.filter(i => i.detected);
  const rulesTable = detected.length
    ? detected.map(i => `| ${i.id} | ${i.title.split('`').join("'").slice(0, 90)} |`).join('\n')
    : '*(no issues detected in current source)*';

  return `---
name: realtimex-moderator-sdk
description: Control and interact with the RealTimeX application through its Node.js SDK. This skill should be used when users want to manage workspaces, threads, agents, activities, LLM chat, vector store, MCP tools, ACP agent sessions, TTS/STT, or any other RealTimeX platform feature via the API. All method signatures are verified against the SDK source code.
generated: ${new Date().toISOString().slice(0,10)}
sdk_version: ${pkgVersion}
---

# RealTimeX Moderator (SDK Source-Verified)

Interact with the RealTimeX desktop app (\`http://localhost:3001\`) using \`@realtimex/sdk\` **v${pkgVersion}** in Developer Mode (API Key).

> Auto-generated from the \`@realtimex/sdk\` TypeScript source.
> Refresh: \`node scripts/generate-skill.mjs --force\` from the SDK repo root.

---

## Authentication

When running inside RealtimeX (via an agent session or on the same machine), authentication is **automatic** — no setup needed.

Handled by \`scripts/lib/sdk-init.js\` — credential resolution priority:
1. Explicit override passed to \`initSDK({ apiKey })\` or \`initSDK({ appId })\`
2. \`REALTIMEX_API_KEY\` / \`REALTIMEX_AI_API_KEY\` in \`<cwd>/.env\`
3. \`RTX_API_KEY\` / \`REALTIMEX_API_KEY\` / \`REALTIMEX_AI_API_KEY\` from \`process.env\`
4. \`RTX_APP_ID\` from \`process.env\` (injected by RealtimeX for agents / local apps)
5. \`~/.realtimex.ai/.sdk-app-id\` file (written by RealTimeX server on startup)
6. Interactive readline prompt (dev fallback)

\`<SKILL_DIR>\` below refers to the directory containing this SKILL.md.

---

## Option A — Bundled CLI

\`\`\`bash
SKILL=<SKILL_DIR>/scripts/rtx.js
ENV=--env-dir=<cwd>

node "$SKILL" ping                                     $ENV
node "$SKILL" agents                                   $ENV
node "$SKILL" workspaces                               $ENV
node "$SKILL" threads <workspace-slug>                 $ENV
node "$SKILL" trigger-agent <agent> <workspace> <msg>  $ENV
node "$SKILL" acp-chat qwen "question" --cwd=<path>    $ENV
node "$SKILL" llm-chat "message"                       $ENV
node "$SKILL" activities --status=pending              $ENV
node "$SKILL" mcp-servers                              $ENV
node "$SKILL" help
\`\`\`

## Option B — Custom script

\`\`\`js
const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');
const { sdk, apiKey } = await initSDK({ envDir: process.cwd() });
// All SDK APIs — see references/api-reference.md
\`\`\`

---

## Critical Rules (source-detected)

| # | Issue |
|---|-------|
${rulesTable}

Full fixes in \`references/known-issues.md\`.

---

## Key Facts

- **Metadata methods** (\`getAgents\`, \`getWorkspaces\`, etc.) live on \`sdk.api.*\`, not \`sdk.*\`
- **\`sdk.webhook.triggerAgent()\`** sends wrong event type — always use raw fetch with \`event: "trigger-agent"\`
- **\`sdk.task\`** methods: \`start(uuid)\`, \`complete(uuid, result)\`, \`fail(uuid, "error")\` — positional args
- **ACP sessions** need \`approvalPolicy: 'approve-all'\` for autonomous scripts
- **SDK env vars:** \`RTX_API_KEY\` (dev), \`RTX_APP_ID\` (prod), \`RTX_APP_NAME\`

## References

- \`references/api-reference.md\` — all class methods (auto-generated from source)
- \`references/known-issues.md\` — verified source mismatches (auto-generated)
`;
}

// ---------------------------------------------------------------------------
// Runtime scripts — embedded verbatim so the skill is fully self-contained.
// These are written to scripts/ on every generator run (never skipped).
// ---------------------------------------------------------------------------

const SDK_INIT_JS = `'use strict';
/**
 * sdk-init.js — SDK initializer with automatic credential resolution
 * AUTO-GENERATED by scripts/generate-skill.mjs — do not edit by hand.
 *
 * Source reference: typescript/src/index.ts (RealtimeXSDK constructor)
 *
 * Credential resolution priority:
 *   1. Explicit override passed to initSDK({ apiKey } or { appId })
 *   2. REALTIMEX_API_KEY / REALTIMEX_AI_API_KEY in <envDir>/.env
 *   3. RTX_API_KEY / REALTIMEX_API_KEY / REALTIMEX_AI_API_KEY in process.env
 *   4. RTX_APP_ID in process.env (injected by RealtimeX for agents / local apps)
 *   5. ~/.realtimex.ai/.sdk-app-id file (written by RealtimeX server on startup)
 *   6. Interactive readline prompt (dev fallback)
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const readline = require('readline');

const ALL_PERMISSIONS = [
  'api.agents', 'api.workspaces', 'api.threads', 'api.task',
  'webhook.trigger', 'activities.read', 'activities.write',
  'llm.chat', 'llm.embed', 'llm.providers',
  'vectors.read', 'vectors.write',
  'tts.generate', 'mcp.servers', 'mcp.tools', 'acp.agent',
];

/** Well-known file written by RealtimeX server for seamless SDK auth. */
const SDK_APP_ID_FILE = path.join(os.homedir(), '.realtimex.ai', '.sdk-app-id');

function parseEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  for (const raw of fs.readFileSync(filePath, 'utf-8').split('\\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    vars[key] = val;
  }
  return vars;
}

/**
 * Resolve credentials using the full priority chain.
 * Returns { apiKey, appId } — exactly one will be set.
 */
async function resolveCredentials({ envDir, apiKey, appId } = {}) {
  // 1. Explicit overrides
  if (apiKey) return { apiKey, appId: null };
  if (appId) return { apiKey: null, appId };

  // 2. .env file
  const envVars = parseEnvFile(path.join(envDir || process.cwd(), '.env'));
  const fromFile = envVars.REALTIMEX_API_KEY || envVars.REALTIMEX_AI_API_KEY;
  if (fromFile) return { apiKey: fromFile, appId: null };

  // 3. Process env — API key
  const fromEnv = process.env.RTX_API_KEY || process.env.REALTIMEX_API_KEY || process.env.REALTIMEX_AI_API_KEY;
  if (fromEnv) return { apiKey: fromEnv, appId: null };

  // 4. Process env — App ID (injected by RealtimeX for agents / local apps)
  const envAppId = process.env.RTX_APP_ID;
  if (envAppId) return { apiKey: null, appId: envAppId };

  // 5. Well-known file (written by RealtimeX server on startup)
  try {
    if (fs.existsSync(SDK_APP_ID_FILE)) {
      const fileAppId = fs.readFileSync(SDK_APP_ID_FILE, 'utf-8').trim();
      if (fileAppId) return { apiKey: null, appId: fileAppId };
    }
  } catch { /* ignore read errors */ }

  // 6. Interactive prompt (dev fallback)
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => {
    rl.question('RealTimeX API key not found. Enter your API key: ', (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
  if (answer) return { apiKey: answer, appId: null };

  return { apiKey: null, appId: null };
}

/** @deprecated Use resolveCredentials() instead */
async function resolveApiKey(opts = {}) {
  const { apiKey } = await resolveCredentials(opts);
  return apiKey;
}

async function initSDK(opts = {}) {
  const { RealtimeXSDK } = require('@realtimex/sdk');
  const { apiKey, appId } = await resolveCredentials(opts);

  if (!apiKey && !appId) {
    throw new Error(
      'No credentials found. Set REALTIMEX_API_KEY in .env, or run inside RealtimeX for automatic auth.'
    );
  }

  const sdk = new RealtimeXSDK({
    realtimex: {
      url: opts.url || 'http://localhost:3001',
      ...(apiKey ? { apiKey } : {}),
      ...(appId ? { appId } : {}),
    },
    permissions: opts.permissions || ALL_PERMISSIONS,
  });

  return { sdk, apiKey: apiKey || null, appId: appId || null };
}

module.exports = { initSDK, resolveCredentials, resolveApiKey, parseEnvFile, ALL_PERMISSIONS, SDK_APP_ID_FILE };
`;

const RTX_JS = `#!/usr/bin/env node
'use strict';
/**
 * rtx.js — RealTimeX SDK CLI (source-verified)
 * AUTO-GENERATED by scripts/generate-skill.mjs — do not edit by hand.
 *
 * All method signatures derived from the @realtimex/sdk TypeScript source.
 *
 * Usage: node rtx.js <command> [args...] [--flags]
 * Global flags:
 *   --api-key=<key>    Override API key
 *   --env-dir=<path>   Directory containing .env (default: cwd)
 *   --url=<url>        RealTimeX server URL (default: http://localhost:3001)
 */

const path = require('path');
const { initSDK } = require('./lib/sdk-init');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const flags = {}, positional = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, ...rest] = arg.slice(2).split('=');
      flags[k] = rest.length ? rest.join('=') : true;
    } else { positional.push(arg); }
  }
  return { flags, positional };
}
const { flags, positional } = parseArgs(process.argv.slice(2));
const [command, ...cmdArgs] = positional;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function print(obj) { console.log(JSON.stringify(obj, null, 2)); }
function printTable(rows, cols) {
  if (!rows?.length) { console.log('(no results)'); return; }
  const keys = cols || Object.keys(rows[0]);
  const widths = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)));
  const pad = (s, w) => String(s ?? '').padEnd(w);
  console.log(keys.map((k, i) => pad(k, widths[i])).join('  '));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(keys.map((k, i) => pad(r[k], widths[i])).join('  '));
}

let _sdk = null;
async function getSDK() {
  if (_sdk) return _sdk;
  _sdk = await initSDK({ envDir: flags['env-dir'] || process.cwd(), apiKey: flags['api-key'], url: flags['url'] });
  return _sdk;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
const CMD = {};

// -- ping -------------------------------------------------------------------
// Source: index.ts → sdk.ping() → { success, mode, appId, timestamp }
CMD.ping = async () => { const { sdk } = await getSDK(); print(await sdk.ping()); };

// -- info -------------------------------------------------------------------
CMD.info = async () => {
  const { sdk, apiKey } = await getSDK();
  console.log('API key: ' + apiKey.slice(0, 8) + '...');
  try { console.log('Data dir: ' + await sdk.getAppDataDir()); } catch (_) {}
  print(await sdk.ping());
};

// -- agents -----------------------------------------------------------------
// Source: modules/api.ts → ApiModule.getAgents() → Agent[]
// Agent: { slug, name, description?, hub_id? }
// NOTE: on sdk.api, NOT sdk directly
CMD.agents = async () => {
  const { sdk } = await getSDK();
  printTable(await sdk.api.getAgents(), ['slug', 'name', 'description']);
};

// -- workspaces -------------------------------------------------------------
// Source: ApiModule.getWorkspaces() → Workspace[] { id, slug, name, type }
CMD.workspaces = async () => {
  const { sdk } = await getSDK();
  printTable(await sdk.api.getWorkspaces(), ['id', 'slug', 'name', 'type']);
};

// -- threads ----------------------------------------------------------------
// Source: ApiModule.getThreads(workspaceSlug) → Thread[] { id, slug, name }
CMD.threads = async () => {
  const [slug] = cmdArgs;
  if (!slug) { console.error('Usage: rtx.js threads <workspace-slug>'); process.exit(1); }
  const { sdk } = await getSDK();
  printTable(await sdk.api.getThreads(slug), ['id', 'slug', 'name']);
};

// -- task -------------------------------------------------------------------
// Source: ApiModule.getTask(taskUuid) → Task { uuid, title, status, ..., runs }
CMD.task = async () => {
  const [uuid] = cmdArgs;
  if (!uuid) { console.error('Usage: rtx.js task <uuid>'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.api.getTask(uuid));
};

// -- activities -------------------------------------------------------------
// Source: ActivitiesModule.list(options?) → Activity[]  (direct array, NOT { activities: [...] })
CMD.activities = async () => {
  const { sdk } = await getSDK();
  const opts = {};
  if (flags.status) opts.status = flags.status;
  if (flags.limit)  opts.limit  = Number(flags.limit);
  if (flags.offset) opts.offset = Number(flags.offset);
  print(await sdk.activities.list(opts));
};

// -- activity-get -----------------------------------------------------------
// Source: ActivitiesModule.get(id) → Activity | null
CMD['activity-get'] = async () => {
  const [id] = cmdArgs;
  if (!id) { console.error('Usage: rtx.js activity-get <id>'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.activities.get(id));
};

// -- activity-create --------------------------------------------------------
// Source: ActivitiesModule.insert(rawData: Record<string,unknown>) → Activity
// rawData is your payload; SDK wraps it in { raw_data: rawData } automatically.
CMD['activity-create'] = async () => {
  const [jsonStr] = cmdArgs;
  if (!jsonStr) { console.error('Usage: rtx.js activity-create <json-payload>'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.activities.insert(JSON.parse(jsonStr)));
};

// -- activity-update --------------------------------------------------------
// Source: ActivitiesModule.update(id, updates: Partial<Activity>) → Activity
CMD['activity-update'] = async () => {
  const [id, jsonStr] = cmdArgs;
  if (!id || !jsonStr) { console.error('Usage: rtx.js activity-update <id> <json-updates>'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.activities.update(id, JSON.parse(jsonStr)));
};

// -- activity-delete --------------------------------------------------------
// Source: ActivitiesModule.delete(id) → void
CMD['activity-delete'] = async () => {
  const [id] = cmdArgs;
  if (!id) { console.error('Usage: rtx.js activity-delete <id>'); process.exit(1); }
  const { sdk } = await getSDK();
  await sdk.activities.delete(id);
  console.log('Deleted.');
};

// -- task-start / task-complete / task-fail ---------------------------------
// Source: modules/task.ts
// CORRECT signatures (positional, NOT { task_uuid } object):
//   start(taskUuid, machineIdOrOptions?)
//   complete(taskUuid, result?, machineIdOrOptions?)
//   fail(taskUuid, error: string, machineIdOrOptions?)
CMD['task-start'] = async () => {
  const [uuid] = cmdArgs;
  if (!uuid) { console.error('Usage: rtx.js task-start <uuid> [--machine=<id>]'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.task.start(uuid, flags.machine ? { machineId: flags.machine } : undefined));
};
CMD['task-complete'] = async () => {
  const [uuid, resultStr] = cmdArgs;
  if (!uuid) { console.error('Usage: rtx.js task-complete <uuid> [<result-json>] [--machine=<id>]'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.task.complete(uuid, resultStr ? JSON.parse(resultStr) : {}, flags.machine ? { machineId: flags.machine } : undefined));
};
CMD['task-fail'] = async () => {
  const [uuid, ...errParts] = cmdArgs;
  const errMsg = errParts.join(' ');
  if (!uuid || !errMsg) { console.error('Usage: rtx.js task-fail <uuid> <error-message>'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.task.fail(uuid, errMsg, flags.machine ? { machineId: flags.machine } : undefined));
};
CMD['task-progress'] = async () => {
  const [uuid, dataStr] = cmdArgs;
  if (!uuid) { console.error('Usage: rtx.js task-progress <uuid> [<progress-json>]'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.task.progress(uuid, dataStr ? JSON.parse(dataStr) : {}));
};
CMD['task-cancel'] = async () => {
  const [uuid, ...reasonParts] = cmdArgs;
  if (!uuid) { console.error('Usage: rtx.js task-cancel <uuid> [<reason>]'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.task.cancel(uuid, reasonParts.join(' ') || undefined));
};

// -- trigger-agent ----------------------------------------------------------
// IMPORTANT: sdk.webhook.triggerAgent() sends event "task.trigger" which the
// server rejects (expects "trigger-agent"). This command bypasses the SDK
// method and uses a direct fetch call with the correct event string.
// Source evidence: modules/webhook.ts hardcodes event: 'task.trigger'
//                  server/endpoints/sdk/webhook.js enum: ['trigger-agent',...]
CMD['trigger-agent'] = async () => {
  const [agentName, workspaceSlug, ...promptParts] = cmdArgs;
  const prompt = promptParts.join(' ');
  if (!agentName || !workspaceSlug || !prompt) {
    console.error('Usage: rtx.js trigger-agent <agent-name> <workspace-slug> <prompt> [--thread=<slug>] [--data=<json>]');
    process.exit(1);
  }
  const { apiKey } = await getSDK();
  const resp = await fetch('http://localhost:3001/webhooks/realtimex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      event: 'trigger-agent',
      payload: {
        auto_run: true,
        agent_name: agentName,
        workspace_slug: workspaceSlug,
        thread_slug: flags.thread || undefined,
        prompt,
        raw_data: flags.data ? JSON.parse(flags.data) : {},
      },
    }),
  });
  print(await resp.json());
};

// -- webhook-ping -----------------------------------------------------------
// Source: WebhookModule.ping() → sends event: 'system.ping' (accepted by server)
CMD['webhook-ping'] = async () => {
  const { sdk } = await getSDK();
  print(await sdk.webhook.ping());
};

// -- llm-providers ----------------------------------------------------------
// Source: LLMModule.chatProviders() → { success, providers: [{ provider, models }] }
CMD['llm-providers'] = async () => {
  const { sdk } = await getSDK();
  const { providers } = await sdk.llm.chatProviders();
  for (const p of (providers || [])) {
    console.log('\\nProvider: ' + p.provider);
    if (p.models?.length) printTable(p.models, ['id', 'name']);
  }
};
CMD['embed-providers'] = async () => {
  const { sdk } = await getSDK();
  const { providers } = await sdk.llm.embedProviders();
  for (const p of (providers || [])) {
    console.log('\\nProvider: ' + p.provider);
    if (p.models?.length) printTable(p.models, ['id', 'name']);
  }
};

// -- llm-chat ---------------------------------------------------------------
// Source: LLMModule.chat() → ChatResponse { success, response?: { content, model, metrics } }
// Access text via res.response?.content  (NOT choices[0].message.content)
// Stream: yields StreamChunk { textResponse?, close?, error? }  (NOT delta.content)
CMD['llm-chat'] = async () => {
  const message = cmdArgs.join(' ');
  if (!message) { console.error('Usage: rtx.js llm-chat <message> [--stream] [--model=<m>] [--provider=<p>]'); process.exit(1); }
  const { sdk } = await getSDK();
  const opts = {};
  if (flags.model)    opts.model    = flags.model;
  if (flags.provider) opts.provider = flags.provider;
  if (flags.stream) {
    for await (const chunk of sdk.llm.chatStream([{ role: 'user', content: message }], opts)) {
      if (chunk.textResponse) process.stdout.write(chunk.textResponse);
      if (chunk.close) break;
    }
    process.stdout.write('\\n');
  } else {
    const res = await sdk.llm.chat([{ role: 'user', content: message }], opts);
    console.log(res.response?.content ?? res.error ?? JSON.stringify(res));
  }
};

// -- llm-embed --------------------------------------------------------------
// Source: LLMModule.embed(input: string | string[], options?)
// Returns: EmbedResponse { success, embeddings: number[][], model, dimensions }
CMD['llm-embed'] = async () => {
  const text = cmdArgs.join(' ');
  if (!text) { console.error('Usage: rtx.js llm-embed <text> [--model=<m>]'); process.exit(1); }
  const { sdk } = await getSDK();
  const res = await sdk.llm.embed(text, { model: flags.model, provider: flags.provider });
  console.log('success: ' + res.success + ', model: ' + res.model + ', dimensions: ' + res.dimensions);
  if (flags.vectors && res.embeddings?.[0]) print(res.embeddings[0].slice(0, 10));
};

// -- mcp-servers ------------------------------------------------------------
// Source: MCPModule.getServers(provider?: 'local'|'remote'|'all')
// CORRECT: plain string arg, NOT { provider: 'all' }
CMD['mcp-servers'] = async () => {
  const { sdk } = await getSDK();
  printTable(await sdk.mcp.getServers(flags.provider || 'all'), ['name', 'provider', 'status']);
};
CMD['mcp-tools'] = async () => {
  const [name] = cmdArgs;
  if (!name) { console.error('Usage: rtx.js mcp-tools <server-name> [--provider=local|remote]'); process.exit(1); }
  const { sdk } = await getSDK();
  printTable(await sdk.mcp.getTools(name, flags.provider), ['name', 'description']);
};
CMD['mcp-exec'] = async () => {
  const [server, tool, argsStr] = cmdArgs;
  if (!server || !tool) { console.error('Usage: rtx.js mcp-exec <server> <tool> [<args-json>] [--provider=local|remote]'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.mcp.executeTool(server, tool, argsStr ? JSON.parse(argsStr) : {}, flags.provider));
};

// -- acp-agents -------------------------------------------------------------
// Source: AcpAgentModule.listAgents({ includeModels? })
// Returns: AcpAgentInfo[] { id, label, handles[], installed, authReady, status }
CMD['acp-agents'] = async () => {
  const { sdk } = await getSDK();
  printTable(await sdk.acpAgent.listAgents({ includeModels: flags.models === 'true' }), ['id', 'label', 'status', 'authReady', 'installed']);
};
CMD['acp-sessions'] = async () => {
  const { sdk } = await getSDK();
  print(await sdk.acpAgent.listSessions());
};

// -- acp-chat ---------------------------------------------------------------
// Source: AcpAgentModule.createSession + streamChat
// approvalPolicy: 'approve-all' | 'approve-reads' | 'deny-all'
// StreamEvent types: text_delta | status | tool_call | permission_request | done | error | close
// text_delta.data.type === 'thinking' → internal reasoning (not final output)
CMD['acp-chat'] = async () => {
  const [agentId, ...msgParts] = cmdArgs;
  const message = msgParts.join(' ');
  if (!agentId || !message) {
    console.error('Usage: rtx.js acp-chat <agent-id> <message> [--cwd=<path>] [--model=<m>] [--policy=approve-all]');
    process.exit(1);
  }
  const { sdk } = await getSDK();
  const sessionOpts = { agent_id: agentId, cwd: flags.cwd || process.cwd(), approvalPolicy: flags.policy || 'approve-all' };
  if (flags.model) sessionOpts.model = flags.model;
  process.stderr.write('Creating ACP session for "' + agentId + '"...\\n');
  const session = await sdk.acpAgent.createSession(sessionOpts);
  try {
    for await (const event of sdk.acpAgent.streamChat(session.session_key, message)) {
      if (event.type === 'text_delta') {
        if (event.data.type === 'thinking') { if (flags.thoughts) process.stderr.write('[thought] ' + event.data.text + '\\n'); }
        else process.stdout.write(String(event.data.text ?? ''));
      } else if (event.type === 'tool_call') {
        if (!flags.quiet) process.stderr.write('\\n[tool: ' + event.data.tool + ']\\n');
      } else if (event.type === 'error') {
        process.stderr.write('\\nError: ' + event.data.message + '\\n');
      } else if (event.type === 'done' || event.type === 'close') {
        process.stdout.write('\\n');
      }
    }
  } finally { await sdk.acpAgent.closeSession(session.session_key).catch(() => {}); }
};

// -- tts-providers / stt-providers ------------------------------------------
CMD['tts-providers'] = async () => { const { sdk } = await getSDK(); printTable(await sdk.tts.listProviders(), ['id', 'name', 'type', 'configured', 'supportsStreaming']); };
CMD['stt-providers'] = async () => { const { sdk } = await getSDK(); print(await sdk.stt.listProviders()); };

// -- vectors ----------------------------------------------------------------
// Source: LLMModule.vectors (VectorStore sub-module)
CMD['vectors-workspaces'] = async () => { const { sdk } = await getSDK(); print(await sdk.llm.vectors.listWorkspaces()); };
// llm.search() embeds query then calls vectors.query() — high-level helper
CMD['vectors-query'] = async () => {
  const query = cmdArgs.join(' ');
  if (!query) { console.error('Usage: rtx.js vectors-query <query> [--workspace-id=<id>] [--top=5]'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.llm.search(query, { topK: flags.top ? Number(flags.top) : 5, workspaceId: flags['workspace-id'] }));
};
// vectors.upsert: VectorRecord[] = { id, vector: number[], metadata? }
CMD['vectors-upsert'] = async () => {
  const [jsonStr] = cmdArgs;
  if (!jsonStr) { console.error('Usage: rtx.js vectors-upsert <json-VectorRecord[]> [--workspace-id=<id>]'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.llm.vectors.upsert(JSON.parse(jsonStr), { workspaceId: flags['workspace-id'] }));
};
// vectors.delete requires { deleteAll: true } — partial delete by ID not supported
CMD['vectors-delete'] = async () => {
  if (!flags['workspace-id'] && !flags.all) { console.error('Usage: rtx.js vectors-delete --workspace-id=<id>  OR  --all'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.llm.vectors.delete({ deleteAll: true, workspaceId: flags['workspace-id'] }));
};

// -- contract ---------------------------------------------------------------
CMD['contract-info']         = async () => { const { sdk } = await getSDK(); print(await sdk.contract.getLocalAppV1()); };
CMD['contract-capabilities'] = async () => { const { sdk } = await getSDK(); print(await sdk.contract.listCapabilities()); };
CMD['contract-search']       = async () => {
  const query = cmdArgs.join(' ');
  if (!query) { console.error('Usage: rtx.js contract-search <query>'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.contract.searchCapabilities(query));
};
CMD['contract-invoke'] = async () => {
  const [capId, ...rest] = cmdArgs;
  if (!capId) { console.error('Usage: rtx.js contract-invoke <capability-id> [<args-json>]'); process.exit(1); }
  const { sdk } = await getSDK();
  print(await sdk.contract.invoke({ capability_id: capId, args: rest[0] ? JSON.parse(rest[0]) : {}, auto_run: true, agent_name: flags.agent, workspace_slug: flags.workspace, prompt: flags.prompt }));
};

// -- database / auth --------------------------------------------------------
CMD['db-config']   = async () => { const { sdk } = await getSDK(); print(await sdk.database.getConfig()); };
CMD['auth-token']  = async () => { const { sdk } = await getSDK(); print(await sdk.auth.getAccessToken()); };

// -- help -------------------------------------------------------------------
CMD.help = async () => {
  console.log(\`
RealTimeX SDK CLI (source-verified) — rtx.js
============================================

Usage: node rtx.js <command> [args...] [--flags]

Global flags:
  --api-key=<key>       Override API key (skips .env lookup)
  --env-dir=<path>      Directory containing .env (default: cwd)
  --url=<url>           RealTimeX server URL (default: http://localhost:3001)

Connection:
  ping / info

sdk.api.*:
  agents / workspaces / threads <slug> / task <uuid>

sdk.activities.*:
  activities [--status --limit --offset]
  activity-get <id>
  activity-create <json>
  activity-update <id> <json>
  activity-delete <id>

sdk.task.*  (positional args — NOT { task_uuid }):
  task-start <uuid> [--machine=<id>]
  task-complete <uuid> [<result-json>] [--machine=<id>]
  task-fail <uuid> <error-message>
  task-progress <uuid> [<progress-json>]
  task-cancel <uuid> [<reason>]

Trigger  (raw fetch — SDK method sends wrong event type):
  trigger-agent <agent-name> <workspace-slug> <prompt>
    [--thread=<slug>] [--data=<json>]

Webhook:
  webhook-ping

sdk.llm.*:
  llm-providers / embed-providers
  llm-chat <message> [--stream] [--model] [--provider]
  llm-embed <text> [--model] [--vectors]

sdk.llm.vectors.*:
  vectors-workspaces
  vectors-query <text> [--workspace-id] [--top=5]
  vectors-upsert <json-VectorRecord[]> [--workspace-id]
  vectors-delete --workspace-id=<id> | --all

sdk.mcp.*:
  mcp-servers [--provider=local|remote|all]
  mcp-tools <server> [--provider]
  mcp-exec <server> <tool> [<args-json>] [--provider]

sdk.acpAgent.*:
  acp-agents [--models=true]
  acp-sessions
  acp-chat <agent-id> <message>
    [--cwd] [--model] [--policy=approve-all] [--thoughts] [--quiet]

sdk.tts.* / sdk.stt.*:
  tts-providers / stt-providers

sdk.contract.*:
  contract-info / contract-capabilities
  contract-search <query>
  contract-invoke <capability-id> [<args-json>] [--agent] [--workspace] [--prompt]

sdk.database.* / sdk.auth.*:
  db-config / auth-token

  help
\`);
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
(async () => {
  const handler = CMD[command];
  if (!handler) {
    console.error('Unknown command: ' + (command || '(none)') + '\\nRun: node rtx.js help');
    process.exit(1);
  }
  try { await handler(); }
  catch (err) {
    console.error('Error:', err.message || err);
    if (flags.debug) console.error(err);
    process.exit(1);
  }
})();
`;

// ---------------------------------------------------------------------------
// File writer
// ---------------------------------------------------------------------------
function write(filePath, content) {
  if (DRY_RUN) {
    console.log(`[dry-run] ${filePath} (${content.length} bytes)`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`[generate-skill] Wrote ${path.relative(REPO_ROOT, filePath)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const tsPkg = JSON.parse(fs.readFileSync(TS_PKG, 'utf-8'));
const pkgVersion = tsPkg.version || 'unknown';

console.log(`[generate-skill] SDK ${pkgVersion} | out: ${OUT_DIR}`);
if (DRY_RUN) console.log('[generate-skill] DRY RUN — nothing will be written\n');

// Parse all module files
console.log('[generate-skill] Parsing TypeScript source files...');
const modules = MODULE_FILES.map(([rel, key, group]) => {
  const fp = path.join(TS_SRC, rel);
  if (!fs.existsSync(fp)) {
    console.warn(`  [skip] ${rel} — not found`);
    return [rel, key, group, null];
  }
  const data = parseFile(fp);
  const names = data.classes.map(c => c.name).join(', ');
  console.log(`  ${rel.padEnd(28)} → ${names || '(no exported classes)'}`);
  return [rel, key, group, data];
});

// Detect known issues
console.log('\n[generate-skill] Detecting known issues...');
const issues = detectKnownIssues(TS_SRC);
for (const i of issues) {
  console.log(`  [${i.detected ? '🔴' : '⚪'}] #${i.id} ${i.file}`);
}
console.log(`  ${issues.filter(i=>i.detected).length}/${issues.length} detected\n`);

// Generate files
const apiRef     = generateApiReference(modules, pkgVersion);
const knownIssues = generateKnownIssues(issues, pkgVersion);
const skillMd    = generateSkillMd(modules, pkgVersion, issues);

const skillMdPath  = path.join(OUT_DIR, 'SKILL.md');
const apiRefPath   = path.join(OUT_DIR, 'references', 'api-reference.md');
const issuesPath   = path.join(OUT_DIR, 'references', 'known-issues.md');

// Runtime scripts — always written (never conditional on --force)
write(path.join(OUT_DIR, 'scripts', 'lib', 'sdk-init.js'), SDK_INIT_JS);
write(path.join(OUT_DIR, 'scripts', 'rtx.js'), RTX_JS);

// Markdown — api-reference and known-issues always updated
write(apiRefPath,  apiRef);
write(issuesPath,  knownIssues);

// SKILL.md — only overwrite if --force or new
if (fs.existsSync(skillMdPath) && !FORCE && !DRY_RUN) {
  console.log('[generate-skill] SKILL.md exists — skipping (use --force to overwrite)');
} else {
  write(skillMdPath, skillMd);
}

console.log('\n[generate-skill] Done.');
if (!DRY_RUN) {
  console.log(`\nTo regenerate after SDK changes:`);
  console.log(`  node scripts/generate-skill.mjs --force`);
}
