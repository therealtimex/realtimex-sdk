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

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = path.resolve(__dirname, '..');
const TS_SRC       = path.join(REPO_ROOT, 'typescript', 'src');
const TS_PKG       = path.join(REPO_ROOT, 'typescript', 'package.json');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

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

const MODULE_GROUP_OVERRIDES = {
  agent: 'sdk.agent — LLM Agent Sessions (REST/SSE)',
};

// ---------------------------------------------------------------------------
// Markdown generators
// ---------------------------------------------------------------------------

function renderMethodSig(m) {
  const asyncKw = m.async && !m.generator ? 'async ' : '';
  const genKw   = m.generator ? 'async *' : '';
  const statKw  = m.static ? 'static ' : '';
  return `${statKw}${asyncKw}${genKw}${m.name}(${m.params}): ${m.returnType}`;
}

function slugify(value) {
  return String(value || '')
    .replace(/sdk\.v1\./g, 'v1-')
    .replace(/sdk\./g, '')
    .replace(/—.*$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function moduleReferenceFileName(key, group) {
  if (key === 'sdk') return 'core.md';
  return `${slugify(group || key)}.md`;
}

function renderModuleReference(group, data, pkgVersion) {
  const L = [];
  L.push(`# ${group}`);
  L.push(``);
  L.push(`> Auto-generated from \`@realtimex/sdk\` source · v**${pkgVersion}** · ${new Date().toISOString().slice(0,10)}`);
  L.push(``);

  if (!data?.classes?.length && !data?.interfaces?.length) {
    L.push(`No exported SDK classes or surface interfaces were detected for this module.`);
    return L.join('\n');
  }

  for (const cls of data.classes || []) {
    if (['ContractRuntime','ContractCache','ContractClient','RetryPolicy',
         'ScopeGuard','StaticAuthProvider','ToolProjector','ExecutionStore',
         'LifecycleReporter','LLMPermissionError','LLMProviderError',
         'PermissionDeniedError','PermissionRequiredError'].includes(cls.name)) continue;

    L.push(`## \`${cls.name}\`${cls.extends ? ` *(extends ${cls.extends})*` : ''}`);
    L.push(``);
    if (cls.jsDoc) {
      L.push(`> ${cls.jsDoc}`);
      L.push(``);
    }

    const notableProps = cls.props.filter(p =>
      !['realtimexUrl','baseUrl','appId','appName','apiKey','httpClient',
        'callbackSecret','signCallbacksByDefault','permissions'].includes(p.name)
    );
    if (notableProps.length) {
      L.push(`### Public Properties`);
      L.push(``);
      for (const p of notableProps) {
        L.push(`- \`${p.readonly ? 'readonly ' : ''}${p.name}: ${p.type}\``);
      }
      L.push(``);
    }

    if (cls.methods.length) {
      L.push(`### Methods`);
      L.push(``);
      L.push('```ts');
      for (const m of cls.methods) {
        if (m.jsDoc) L.push(`// ${m.jsDoc}`);
        L.push(renderMethodSig(m));
        L.push('');
      }
      while (L[L.length - 1] === '') L.pop();
      L.push('```');
      L.push(``);
    }
  }

  for (const iface of (data.interfaces || [])) {
    if (!SURFACE_INTERFACES.has(iface.name)) continue;
    L.push(`## \`${iface.name}\``);
    L.push(``);
    if (iface.jsDoc) {
      L.push(`> ${iface.jsDoc}`);
      L.push(``);
    }
    if (iface.members.length) {
      L.push('```ts');
      for (const m of iface.members) L.push(m);
      L.push('```');
      L.push(``);
    }
  }

  while (L[L.length - 1] === '') L.pop();
  return L.join('\n') + '\n';
}

function generateApiReferenceIndex(modules, pkgVersion) {
  const L = [];
  L.push(`# API Reference Index`);
  L.push(``);
  L.push(`> Auto-generated from \`@realtimex/sdk\` source · v**${pkgVersion}** · ${new Date().toISOString().slice(0,10)}`);
  L.push(``);
  L.push(`Use these files for exact SDK signatures. Topic guides in \`references/*.md\` explain workflows.`);
  L.push(``);
  L.push(`| Module | File |`);
  L.push(`|---|---|`);
  for (const [, key, group, data] of modules) {
    if (!data?.classes?.length && !data?.interfaces?.length) continue;
    const file = moduleReferenceFileName(key, group);
    L.push(`| ${group} | [${file}](./${file}) |`);
  }
  L.push(``);
  L.push(`The legacy aggregate reference remains available at \`../api-reference.md\`.`);
  return L.join('\n') + '\n';
}

function generateTopicReferences(pkgVersion) {
  const date = new Date().toISOString().slice(0, 10);
  const header = (title) => `# ${title}\n\n> Generated workflow guide · SDK **${pkgVersion}** · ${date}\n\n`;
  return {
    'quickstart.md': header('Quickstart') + [
      'Use this when starting any SDK task.',
      '',
      '```js',
      "const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');",
      'const { sdk, context } = await initSDK();',
      '```',
      '',
      'Rules:',
      '- Use the working directory or system temp for helper scripts, never the skill directory.',
      '- Exit scripts explicitly with `process.exit(0)` or `process.exit(1)`.',
      '- Check `context.workspaceSlug` and `context.threadSlug` before asking the user.',
      '- For exact signatures, open `references/api-reference/index.md`.',
      '',
    ].join('\n'),
    'permissions.md': header('Permissions') + [
      'LocalApps using `x-app-id` must request permissions before calling protected SDK routes.',
      '',
      '| Permission | Use For |',
      '|---|---|',
      '| `api.agents` | List agents |',
      '| `api.workspaces` | List workspaces |',
      '| `api.threads` | List workspace threads |',
      '| `api.task` | Read task status |',
      '| `activities.read` | Read activities |',
      '| `activities.write` | Create/update/delete activities |',
      '| `llm.chat` | LLM chat and streaming chat |',
      '| `llm.embed` | Generate embeddings |',
      '| `llm.providers` | List LLM/embed providers |',
      '| `vectors.read` | Query/list vector stores |',
      '| `vectors.write` | Upsert/delete vectors |',
      '| `mcp.servers` | List MCP servers |',
      '| `mcp.tools` | List/execute MCP tools |',
      '| `acp.agent` | ACP agent sessions |',
      '| `desktop.runtime-sessions` | Visible Electron terminal sessions |',
      '| `desktop.browser` | RealTimeX Browser sessions and tabs |',
      '| `channels.manage` | External chat channel setup and administration |',
      '| `tts.generate` | Text-to-speech |',
      '| `stt.listen` | Speech-to-text |',
      '| `credentials.read` | Read stored credentials |',
      '',
      'API-key dev mode has wildcard access.',
      '',
    ].join('\n'),
    'workspaces.md': header('Workspaces And Threads') + [
      'Use this before any task that needs workspace/thread context.',
      '',
      'Priority order:',
      '1. Explicit user-provided workspace/thread.',
      '2. `context.workspaceSlug` / `context.threadSlug` from `initSDK()`.',
      '3. `RTX_WORKSPACE_SLUG` / `RTX_THREAD_SLUG` in spawned sessions.',
      '4. List workspaces and threads, then ask only if ambiguous.',
      '',
      'Useful calls:',
      '',
      '```js',
      'await sdk.api.getWorkspaces();',
      'await sdk.api.getThreads(workspaceSlug);',
      'await sdk.v1.workspace.listWorkspaces();',
      'await sdk.v1.thread.listWorkspaceThreads(slug);',
      '```',
      '',
    ].join('\n'),
    'agents.md': header('Agents') + [
      'Use `sdk.api` for lightweight lists and `sdk.agent` / `sdk.acpAgent` for execution.',
      '',
      '```js',
      'await sdk.api.getAgents();',
      'await sdk.webhook.triggerAgent(agentSlug, workspaceSlug, message);',
      'await sdk.agent.chat({ workspaceSlug, agent: agentSlug, message });',
      '```',
      '',
      'Use ACP only for headless/background CLI agent sessions. Use `sdk.desktopRuntimeSessions` for visible Electron terminals.',
      '',
    ].join('\n'),
    'terminal-sessions.md': header('Desktop Terminal Sessions') + [
      'Use this for visible Electron terminal sessions.',
      '',
      'Correct namespace:',
      '',
      '```js',
      'sdk.desktopRuntimeSessions',
      '```',
      '',
      'Do not use ACP for visible terminals unless the user explicitly asks for headless ACP.',
      '',
      'Examples:',
      '',
      '```js',
      'await sdk.desktopRuntimeSessions.launchTerminalCliAgent({',
      '  workspaceSlug,',
      '  threadSlug,',
      '  agentName: "claude",',
      '  providerId: "claude-cli",',
      '  presentationMode: "panel",',
      '  message: "what is current working dir"',
      '});',
      '',
      'await sdk.desktopRuntimeSessions.launchTerminalShell({',
      '  workspaceSlug,',
      '  threadSlug,',
      '  presentationMode: "panel",',
      '  initialCommand: "pwd",',
      '  initialCommandMode: "direct"',
      '});',
      '```',
      '',
    ].join('\n'),
    'browser.md': header('RealTimeX Browser') + [
      'Use this for managed RealTimeX Browser sessions and tabs.',
      '',
      'Correct namespace:',
      '',
      '```js',
      'sdk.desktopBrowser',
      '```',
      '',
      'Preferred flow:',
      '1. Create or get a named browser session.',
      '2. Read its `remoteDebugPort`.',
      '3. Use the `agent-browser` skill against that CDP port for page interaction.',
      '',
      '```js',
      'await sdk.desktopBrowser.createSession({ sessionName: "docs-research" });',
      'await sdk.desktopBrowser.createTab({',
      '  sessionName: "docs-research",',
      '  url: "https://example.com"',
      '});',
      'const session = await sdk.desktopBrowser.getSession("docs-research");',
      '```',
      '',
      'Avoid mutating reserved `acp-*` browser sessions unless the user explicitly asks for internal ACP browser flows.',
      '',
    ].join('\n'),
    'channels.md': header('External Chat Channels') + [
      'Use this for Telegram, Zalo, WhatsApp, Discord, Slack, and other chat channel setup.',
      '',
      'Required LocalApp permission for `x-app-id` mode:',
      '',
      '```js',
      'permissions: ["channels.manage"]',
      '```',
      '',
      'Main namespace:',
      '',
      '```js',
      'sdk.v1.channels',
      '```',
      '',
      '## Agent Setup Rules',
      '',
      '- Never print bot tokens, credentials, QR auth state, or full config values back to chat.',
      '- Do not guess workspace or thread. Load `skills get workspaces` if context is missing.',
      '- Ask the user to complete provider-side steps that cannot be automated, such as BotFather setup or QR scanning.',
      '- Prefer creating plugins disabled first, then start only after credentials/login/policies are ready.',
      '- Use `settings.thread_id` only when the user explicitly wants messages routed to a specific thread.',
      '- Use `agentWhitelist: ["*"]` only when the user wants any mentioned/available agent allowed. Otherwise ask which agents should be allowed.',
      '',
      '## Decision Tree',
      '',
      '- User says Telegram: ask for workspace and Telegram bot token. If they do not have a token, tell them to create one in BotFather first.',
      '- User says WhatsApp: create a `whatsapp` plugin with empty config, start QR login, ask the user to scan, poll state, configure policies, then start.',
      '- User says Zalo personal: create a `zalo_personal` plugin with empty config, start QR login, ask the user to scan, poll state, configure policies, then start.',
      '- User asks to restrict access: use pairing codes or provider policies.',
      '- User asks to allow anyone: set permissive policies only after confirming the security tradeoff.',
      '- User is unsure which provider: list supported values: `telegram`, `slack`, `discord`, `zalo`, `zalo_personal`, `whatsapp`.',
      '',
      '## Common Flow',
      '',
      '1. Resolve workspace and optional target thread.',
      '2. Identify provider and collect only the needed credential or QR action.',
      '3. For token providers, call `pluginsTest(...)` before creating when supported.',
      '4. Create plugin with `createPlugin(...)` and `enabled: false`.',
      '5. For QR providers, call `pluginsQrLoginStart(...)`, ask the user to scan, then poll `getState(...)` until connected or failed.',
      '6. Configure policies with `pluginsPolicies(...)` where relevant.',
      '7. Start with `pluginsStart(...)`.',
      '8. Verify `getStatus()` and ask the user to send a first message from the external platform.',
      '',
      '## Telegram Bot',
      '',
      'Provider-side step: the user must create a Telegram bot with BotFather and provide the bot token.',
      '',
      'Test credentials:',
      '',
      '```js',
      'await sdk.v1.channels.pluginsTest({',
      '  plugin_type: "telegram",',
      '  config: { botToken: process.env.TELEGRAM_BOT_TOKEN }',
      '});',
      '```',
      '',
      'Create plugin:',
      '',
      '```js',
      'const created = await sdk.v1.channels.createPlugin({',
      '  workspace_id: 1,',
      '  plugin_type: "telegram",',
      '  name: "Support Telegram",',
      '  enabled: false,',
      '  config: { botToken: process.env.TELEGRAM_BOT_TOKEN },',
      '  settings: { thread_id: null, agentWhitelist: ["*"] }',
      '});',
      'await sdk.v1.channels.pluginsStart(String(created.plugin.id));',
      '```',
      '',
      'First-message check: ask the user to open Telegram, start the bot, and send a test message.',
      '',
      '## WhatsApp QR',
      '',
      'Provider-side step: the user must scan the QR code with WhatsApp.',
      '',
      '```js',
      'const created = await sdk.v1.channels.createPlugin({',
      '  workspace_id: 1,',
      '  plugin_type: "whatsapp",',
      '  name: "WhatsApp",',
      '  enabled: false,',
      '  config: {},',
      '  settings: { thread_id: null, agentWhitelist: ["*"] }',
      '});',
      '',
      'const id = String(created.plugin.id);',
      'await sdk.v1.channels.pluginsQrLoginStart(id, { force: false });',
      '',
      '// Poll until status.connected is true, status.status is error, or user cancels.',
      'const state = await sdk.v1.channels.getState(id);',
      '',
      'await sdk.v1.channels.pluginsPolicies(id, {',
      '  policies: {',
      '    dmPolicy: "pairing",',
      '    groupPolicy: "disabled",',
      '    selfChatMode: false',
      '  }',
      '});',
      '',
      'await sdk.v1.channels.pluginsStart(id);',
      '```',
      '',
      'Policy guidance:',
      '- `dmPolicy: "pairing"` is safer for private access.',
      '- Keep `groupPolicy: "disabled"` unless the user explicitly wants group chat support.',
      '- Enable `selfChatMode` only when the user understands the loop/testing behavior.',
      '',
      '## Zalo Personal QR',
      '',
      'Provider-side step: the user must scan the QR code with Zalo.',
      '',
      '```js',
      'const created = await sdk.v1.channels.createPlugin({',
      '  workspace_id: 1,',
      '  plugin_type: "zalo_personal",',
      '  name: "Zalo Personal",',
      '  enabled: false,',
      '  config: {},',
      '  settings: { thread_id: null, agentWhitelist: ["*"] }',
      '});',
      '',
      'const id = String(created.plugin.id);',
      'await sdk.v1.channels.pluginsQrLoginStart(id, { force: false });',
      'const state = await sdk.v1.channels.getState(id);',
      '',
      'await sdk.v1.channels.pluginsPolicies(id, {',
      '  policies: {',
      '    dmPolicy: "pairing",',
      '    groupPolicy: "disabled",',
      '    requireMention: false,',
      '    allowFrom: [],',
      '    groups: {}',
      '  }',
      '});',
      '',
      'await sdk.v1.channels.pluginsStart(id);',
      '```',
      '',
      'Directory helpers after login:',
      '',
      '```js',
      'await sdk.v1.channels.listDirectoryFriends(id);',
      'await sdk.v1.channels.listDirectoryGroups(id);',
      '```',
      '',
      '## Pairing And User Approval',
      '',
      'Use pairing when the channel should not allow every external user by default.',
      '',
      '```js',
      'const code = await sdk.v1.channels.pluginsPairingCodes(pluginId, {',
      '  platform_user_id: "external-user-id",',
      '  platform_username: "Customer Name"',
      '});',
      '',
      'await sdk.v1.channels.listPluginPairingCodes(pluginId);',
      'await sdk.v1.channels.pairingCodesApprove(String(code.code.id));',
      'await sdk.v1.channels.listPluginUsers(pluginId);',
      'await sdk.v1.channels.pluginsUsersAuthorization(pluginId, userId, { authorized: true });',
      '```',
      '',
      '## Status And Troubleshooting',
      '',
      '```js',
      'await sdk.v1.channels.listPlugins();',
      'await sdk.v1.channels.getStatus();',
      'await sdk.v1.channels.getConfig(pluginId);',
      '```',
      '',
      '- `Not authenticated`: QR login did not complete or credentials were cleared. Start QR login again.',
      '- Start fails: stop the plugin, test credentials if token-based, check `getStatus()`, then start again.',
      '- User cannot chat: check pairing codes, user authorization, `dmPolicy`, `groupPolicy`, and provider allow lists.',
      '- Messages route to the wrong place: check `workspace_id` and `settings.thread_id`.',
      '- Bot does not receive external messages: confirm provider-side webhook/session requirements and that the plugin is running.',
      '',
      '## Cleanup',
      '',
      '```js',
      'await sdk.v1.channels.pluginsStop(pluginId);',
      'await sdk.v1.channels.pluginsLogout(pluginId); // QR providers only',
      'await sdk.v1.channels.deletePlugin(pluginId);',
      '```',
      '',
      'Exact generated methods are in `api-reference/v1-channels.md`.',
      '',
    ].join('\n'),
    'llm.md': header('LLM And Vector Store') + [
      'Use `sdk.llm` for chat, streaming, embeddings, and vector helpers.',
      '',
      'Common permissions: `llm.chat`, `llm.embed`, `llm.providers`, `vectors.read`, `vectors.write`.',
      '',
      '```js',
      'await sdk.llm.chat([{ role: "user", content: "Hello" }]);',
      'await sdk.llm.embed(["text to embed"]);',
      'await sdk.llm.vectors.query(vector, { workspaceId });',
      '```',
      '',
    ].join('\n'),
    'mcp.md': header('MCP') + [
      'Use `sdk.mcp` to list MCP servers, list tools, and execute tools.',
      '',
      'Required permissions: `mcp.servers` and `mcp.tools`.',
      '',
      '```js',
      'await sdk.mcp.getServers();',
      'await sdk.mcp.getTools(serverName);',
      'await sdk.mcp.executeTool(serverName, toolName, args);',
      '```',
      '',
    ].join('\n'),
    'activities.md': header('Activities') + [
      'Use `sdk.activities` for activity CRUD.',
      '',
      'Required permissions: `activities.read` and/or `activities.write`.',
      '',
      '```js',
      'await sdk.activities.list({ status: "pending" });',
      'await sdk.activities.insert({ type: "note", text: "..." });',
      'await sdk.activities.update(id, updates);',
      'await sdk.activities.delete(id);',
      '```',
      '',
    ].join('\n'),
  };
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
    ['desktop.runtime-sessions', '`sdk.desktopRuntimeSessions.*`'],
    ['desktop.browser',  '`sdk.desktopBrowser.*`'],
  ]) L.push(`| \`${p}\` | ${d} |`);
  L.push(``);
  L.push(`---`);
  L.push(``);

  L.push(`## sdk.desktopRuntimeSessions — Desktop Terminal Sessions`);
  L.push(``);
  L.push(`Use this module for visible Electron terminal sessions. This is the correct path for:`);
  L.push(`- launching a shell terminal`);
  L.push(`- launching Claude/Gemini/Qwen in a terminal`);
  L.push(`- listing existing terminal sessions`);
  L.push(`- sending more input to an existing terminal`);
  L.push(`- approving terminal prompts`);
  L.push(`- closing a terminal session`);
  L.push(``);
  L.push(`Do not use ACP for these unless the user explicitly asks for ACP/headless mode.`);
  L.push(`If the current process was spawned by RealtimeX, prefer \`process.env.RTX_WORKSPACE_SLUG\` and \`process.env.RTX_THREAD_SLUG\` as default context before guessing or asking the user.`);
  L.push(`Always resolve current workspace/thread context first when a terminal action needs it: explicit user input > spawned-process env > list workspaces/threads > ask user if still ambiguous.`);
  L.push(``);
  L.push(`### \`V1DesktopRuntimeSessionsModule\``);
  L.push(``);
  L.push('```ts');
  L.push(`async openLauncher(body?: { workspaceSlug?: string; threadSlug?: string; presentationMode?: 'panel' | 'tab'; preferredAgentName?: string; preferredAgentProviderId?: string; }): Promise<unknown>`);
  L.push(`async launchTerminalShell(body?: { workspaceSlug?: string; threadSlug?: string; presentationMode?: 'panel' | 'tab'; title?: string; subtitle?: string; initialCommand?: string; initialCommandMode?: 'direct' | 'prefill' | 'shell'; }): Promise<unknown>`);
  L.push(`async launchTerminalCliAgent(body?: { workspaceSlug?: string; threadSlug?: string; agentName: string; providerId?: string; modelId?: string; presentationMode?: 'panel' | 'tab'; message?: string; }): Promise<unknown>`);
  L.push(`async listRuntimeSessions(): Promise<unknown>`);
  L.push(`async getRuntimeSession(sessionId: string): Promise<unknown>`);
  L.push(`async write(sessionId: string, body?: { message?: string; input?: string; }): Promise<unknown>`);
  L.push(`async permission(sessionId: string, body?: { outcome: 'approved' | 'denied'; actionId?: string; requestId?: string; optionId?: string; optionLabel?: string; input?: string; reason?: string; }): Promise<unknown>`);
  L.push(`async deleteRuntimeSession(sessionId: string): Promise<unknown>`);
  L.push('```');
  L.push(``);
  L.push(`### Correct examples`);
  L.push(``);
  L.push(`Launch Claude in a terminal:`);
  L.push(``);
  L.push('```js');
  L.push(`await sdk.desktopRuntimeSessions.launchTerminalCliAgent({`);
  L.push(`  workspaceSlug: 'agent-heartbeat',`);
  L.push(`  threadSlug: 'ambient-agent-week-agent-heartbeat-2026-w17',`);
  L.push(`  agentName: 'claude',`);
  L.push(`  providerId: 'claude-cli',`);
  L.push(`  presentationMode: 'panel',`);
  L.push(`  message: 'what is current working dir'`);
  L.push(`});`);
  L.push('```');
  L.push(``);
  L.push(`Launch a shell and run \`pwd\`:`)
  L.push(``);
  L.push('```js');
  L.push(`await sdk.desktopRuntimeSessions.launchTerminalShell({`);
  L.push(`  workspaceSlug: 'agent-heartbeat',`);
  L.push(`  threadSlug: 'ambient-agent-week-agent-heartbeat-2026-w17',`);
  L.push(`  presentationMode: 'panel',`);
  L.push(`  initialCommand: 'pwd',`);
  L.push(`  initialCommandMode: 'direct'`);
  L.push(`});`);
  L.push('```');
  L.push(``);
  L.push(`Default rule: when launching a shell with an initial command, prefer \`initialCommandMode: 'direct'\` unless the user explicitly wants prefill-only behavior.`);
  L.push(``);
  L.push(`Common mistake:`);
  L.push(``);
  L.push('```js');
  L.push(`// ❌ WRONG`);
  L.push(`await sdk.desktopRuntimeSessions.launchTerminalCliAgent({`);
  L.push(`  agentName: 'claude-cli'`);
  L.push(`});`);
  L.push(``);
  L.push(`// ✅ CORRECT`);
  L.push(`await sdk.desktopRuntimeSessions.launchTerminalCliAgent({`);
  L.push(`  agentName: 'claude',`);
  L.push(`  providerId: 'claude-cli'`);
  L.push(`});`);
  L.push('```');
  L.push(``);
  L.push(`Compatibility: \`sdk.v1.desktopRuntimeSessions\` remains available, but prefer the top-level alias.`);
  L.push(``);
  L.push(`---`);
  L.push(``);

  L.push(`## sdk.desktopBrowser — RealTimeX Browser`);
  L.push(``);
  L.push(`Use this module for the managed RealTimeX Browser control plane. This is the correct path for:`);
  L.push(`- listing named browser sessions`);
  L.push(`- creating a named browser session`);
  L.push(`- opening the initial URL for a new browser session`);
  L.push(`- reading/evaluating/focusing/navigating/closing managed browser tabs`);
  L.push(``);
  L.push(`Do not use ACP for these unless the user explicitly asks for ACP browser handoff behavior.`);
  L.push(`Do not use desktop terminal sessions for browser tabs.`);
  L.push(`For page interaction and automation after the session is running, prefer the \`agent-browser\` skill against the session's CDP port.`);
  L.push(`If the user needs a different URL, create a new browser session first instead of relying on opening another managed tab.`);
  L.push(``);
  L.push(`### \`V1DesktopBrowserModule\``);
  L.push(``);
  L.push('```ts');
  L.push(`async listSessions(): Promise<unknown>`);
  L.push(`async createSession(body: { sessionName: string; remoteDebugPort?: number; }): Promise<unknown>`);
  L.push(`async getSession(sessionName: string): Promise<unknown>`);
  L.push(`async deleteSession(sessionName: string): Promise<unknown>`);
  L.push(`async createTab(body: { sessionName?: string; url: string; focus?: boolean; focusWindow?: boolean; }): Promise<unknown>`);
  L.push(`async getTab(tabRef: string): Promise<unknown>`);
  L.push(`async evaluateTab(tabRef: string, body: { expression: string; userGesture?: boolean; }): Promise<unknown>`);
  L.push(`async focusTab(tabRef: string, body?: { focusWindow?: boolean; }): Promise<unknown>`);
  L.push(`async navigateTab(tabRef: string, body: { url: string; focus?: boolean; focusWindow?: boolean; }): Promise<unknown>`);
  L.push(`async deleteTab(tabRef: string): Promise<unknown>`);
  L.push('```');
  L.push(``);
  L.push(`### Correct examples`);
  L.push(``);
  L.push('```js');
  L.push(`await sdk.desktopBrowser.createSession({`);
  L.push(`  sessionName: 'github-review'`);
  L.push(`});`);
  L.push(``);
  L.push(`await sdk.desktopBrowser.createTab({`);
  L.push(`  sessionName: 'github-review',`);
  L.push(`  url: 'https://example.com'`);
  L.push(`});`);
  L.push(``);
  L.push(`const session = await sdk.desktopBrowser.getSession('github-review');`);
  L.push(`const port = session?.session?.remoteDebugPort || session?.runtime?.remoteDebugPort;`);
  L.push(`// Then use the agent-browser skill against http://127.0.0.1:${'${port}'}`);
  L.push(``);
  L.push(`await sdk.desktopBrowser.navigateTab('cli-browser:9555:tab:3', {`);
  L.push(`  url: 'https://docs.realtimex.ai',`);
  L.push(`  focus: true,`);
  L.push(`  focusWindow: true`);
  L.push(`});`);
  L.push(``);
  L.push(`await sdk.desktopBrowser.evaluateTab('cli-browser:9555:tab:3', {`);
  L.push(`  expression: 'document.title',`);
  L.push(`  userGesture: true`);
  L.push(`});`);
  L.push('```');
  L.push(``);
  L.push(`Prefer normal named sessions like \`github-review\` or \`docs-research\`.`);
  L.push(`Avoid mutating reserved/system-managed sessions like \`acp-*\` unless the user explicitly asks for internal ACP browser flows.`);
  L.push(`Compatibility: \`sdk.v1.desktopBrowser\` remains available, but prefer the top-level alias.`);
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
    ? `| # | Issue |\n|---|-------|\n` + detected.map(i => `| ${i.id} | ${i.title.split('`').join("'").slice(0, 90)} |`).join('\n')
    : '*(no issues detected in current source)*';

  const template = fs.readFileSync(path.join(TEMPLATES_DIR, 'SKILL.md'), 'utf-8');
  return template
    .replace('{{DATE}}', new Date().toISOString().slice(0, 10))
    .replace(/\{\{SDK_VERSION\}\}/g, pkgVersion)
    .replace('{{RULES_TABLE}}', rulesTable);
}

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

// Auto-discover generated v1 modules and append to MODULE_FILES
const V1_MODULES_DIR = path.join(TS_SRC, 'v1', 'modules');
if (fs.existsSync(V1_MODULES_DIR)) {
  for (const file of fs.readdirSync(V1_MODULES_DIR).sort()) {
    if (!file.endsWith('.ts')) continue;
    const rel   = `v1/modules/${file}`;
    const key   = file.replace(/\.ts$/, '');
    // "v1Workspace.ts" → "sdk.v1.workspace — v1 Workspaces"
    const label = key.replace(/^v1/, '').replace(/([A-Z])/g, ' $1').trim();
    const group = `sdk.v1.${key.replace(/^v1/, '').charAt(0).toLowerCase() + key.replace(/^v1/, '').slice(1)} — v1 ${label}`;
    MODULE_FILES.push([rel, key, group]);
  }
}

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
  return [rel, key, MODULE_GROUP_OVERRIDES[key] || group, data];
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
const apiIndex   = generateApiReferenceIndex(modules, pkgVersion);
const topicRefs  = generateTopicReferences(pkgVersion);

const skillMdPath  = path.join(OUT_DIR, 'SKILL.md');
const apiRefPath   = path.join(OUT_DIR, 'references', 'api-reference.md');
const apiRefDir    = path.join(OUT_DIR, 'references', 'api-reference');
const issuesPath   = path.join(OUT_DIR, 'references', 'known-issues.md');

// Runtime scripts — read from templates, always written (never conditional on --force)
write(path.join(OUT_DIR, 'scripts', 'lib', 'sdk-init.js'), fs.readFileSync(path.join(TEMPLATES_DIR, 'sdk-init.js'), 'utf-8'));
write(path.join(OUT_DIR, 'scripts', 'rtx.js'), fs.readFileSync(path.join(TEMPLATES_DIR, 'rtx.js'), 'utf-8'));

// Reference files from templates
const credRefSrc = path.join(TEMPLATES_DIR, 'references', 'credentials.md');
if (fs.existsSync(credRefSrc)) {
  write(path.join(OUT_DIR, 'references', 'credentials.md'), fs.readFileSync(credRefSrc, 'utf-8'));
}

// Markdown — api-reference and known-issues always updated
write(apiRefPath,  apiRef);
write(path.join(apiRefDir, 'index.md'), apiIndex);
for (const [, key, group, data] of modules) {
  if (!data?.classes?.length && !data?.interfaces?.length) continue;
  write(
    path.join(apiRefDir, moduleReferenceFileName(key, group)),
    renderModuleReference(group, data, pkgVersion)
  );
}
for (const [file, content] of Object.entries(topicRefs)) {
  write(path.join(OUT_DIR, 'references', file), content);
}
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
