#!/usr/bin/env node
/**
 * generate-v1-sdk.mjs
 *
 * Generates TypeScript and Python SDK modules from openapi.json.
 * Zero npm dependencies — uses only Node.js built-ins.
 *
 * Usage:
 *   node scripts/generate-v1-sdk.mjs               # incremental (digest check)
 *   node scripts/generate-v1-sdk.mjs --force        # always regenerate
 *   node scripts/generate-v1-sdk.mjs --dry-run      # print what would change
 *   node scripts/generate-v1-sdk.mjs --spec=./path/to/openapi.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Paths ───────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const SDK_ROOT       = resolve(__dir, '..');
const TS_MODULES_DIR = resolve(SDK_ROOT, 'typescript/src/v1/modules');
const TS_NAMESPACE   = resolve(SDK_ROOT, 'typescript/src/v1/namespace.ts');
const TS_V1_INDEX    = resolve(SDK_ROOT, 'typescript/src/v1/index.ts');
const PY_V1_DIR      = resolve(SDK_ROOT, 'python/realtimex_sdk/v1');
const PY_INIT        = resolve(SDK_ROOT, 'python/realtimex_sdk/v1/__init__.py');
const DIGEST_FILE    = resolve(__dir, '.sdk-spec-digest.json');
const DEFAULT_SPEC   = resolve(SDK_ROOT, '../realtimex-ai-app/server/swagger/openapi.json');

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const ARGS      = process.argv.slice(2);
const FORCE     = ARGS.includes('--force');
const DRY_RUN   = ARGS.includes('--dry-run');
const specArg   = ARGS.find(a => a.startsWith('--spec='));
const SPEC_PATH = specArg ? resolve(specArg.split('=')[1]) : DEFAULT_SPEC;

// ─── Tag → Module config ──────────────────────────────────────────────────────

const TAG_CONFIG = {
  'Authentication':              { ts: 'v1Auth',          py: 'v1_auth',          cls: 'V1AuthModule',         prop: 'auth',         prefix: ['auth'] },
  'Admin':                       { ts: 'v1Admin',         py: 'v1_admin',         cls: 'V1AdminModule',        prop: 'admin',        prefix: ['admin'] },
  'Workspaces':                  { ts: 'v1Workspace',     py: 'v1_workspace',     cls: 'V1WorkspaceModule',    prop: 'workspace',    prefix: ['workspace', 'workspaces'] },
  'Workspace Threads':           { ts: 'v1Thread',        py: 'v1_thread',        cls: 'V1ThreadModule',       prop: 'thread',       prefix: ['workspace', 'thread'] },
  'Documents':                   { ts: 'v1Document',      py: 'v1_document',      cls: 'V1DocumentModule',     prop: 'document',     prefix: ['document', 'documents'] },
  'System Settings':             { ts: 'v1System',        py: 'v1_system',        cls: 'V1SystemModule',       prop: 'system',       prefix: ['system'] },
  'User Management':             { ts: 'v1Users',         py: 'v1_users',         cls: 'V1UsersModule',        prop: 'users',        prefix: ['users', 'user'] },
  'OpenAI Compatible Endpoints': { ts: 'v1OpenAI',        py: 'v1_openai',        cls: 'V1OpenAIModule',       prop: 'openai',       prefix: ['openai'] },
  'Embed':                       { ts: 'v1Embed',         py: 'v1_embed',         cls: 'V1EmbedModule',        prop: 'embed',        prefix: ['embed'] },
  'STT':                         { ts: 'v1SttApi',        py: 'v1_stt_api',       cls: 'V1SttApiModule',       prop: 'sttApi',       prefix: ['stt'] },
  'Credentials':                 { ts: 'v1Credentials',   py: 'v1_credentials',   cls: 'V1CredentialsModule',  prop: 'credentials',  prefix: ['credentials'] },
  'ACP Auth':                    { ts: 'v1AcpAuth',       py: 'v1_acp_auth',      cls: 'V1AcpAuthModule',      prop: 'acpAuth',      prefix: ['acp', 'auth'] },
  'ACP Commands':                { ts: 'v1AcpCommands',   py: 'v1_acp_commands',  cls: 'V1AcpCommandsModule',  prop: 'acpCommands',  prefix: ['acp', 'command'] },
  'Custom Themes':               { ts: 'v1CustomThemes',  py: 'v1_custom_themes', cls: 'V1CustomThemesModule', prop: 'customThemes', prefix: ['custom-themes'] },
  'Desktop Embed':               { ts: 'v1DesktopEmbed',  py: 'v1_desktop_embed', cls: 'V1DesktopEmbedModule', prop: 'desktopEmbed', prefix: ['desktop-public-embed'] },
};

// Tags handled by SDK core — skip
const SKIP_TAGS = new Set([
  'SDK - Permissions', 'SDK - System', 'SDK - Webhooks', 'SDK - Platform API',
  'SDK - LLM', 'SDK - Vector Store', 'SDK - Activities', 'SDK - Agent',
  'SDK - Agent Session', 'System - Auth', 'SDK - Auth', 'SDK - Database',
  'SDK - MCP Servers', 'SDK - STT', 'SDK - TTS',
]);

// Auto-tag rules for "Untagged" paths (ordered — first match wins)
const AUTO_TAG_RULES = [
  ['/v1/stt/',                  'STT'],
  ['/v1/credentials',           'Credentials'],
  ['/v1/acp/auth/',             'ACP Auth'],
  ['/v1/acp/command',           'ACP Commands'],
  ['/v1/custom-themes',         'Custom Themes'],
  ['/v1/desktop-public-embed/', 'Desktop Embed'],
];

// Paths that require streaming stub (not a full implementation)
const STREAMING_PATHS = new Set([
  '/v1/workspace/{slug}/stream-chat',
  '/v1/workspace/{slug}/thread/{threadSlug}/stream-chat',
]);

// Paths that require multipart/upload stub
const UPLOAD_PATHS = new Set([
  '/v1/document/upload',
  '/v1/document/upload/{folderName}',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toCamelCase(str) {
  return str
    .replace(/[-_/\s]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, c => c.toLowerCase());
}

function toPascalCase(str) {
  const c = toCamelCase(str);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function toSnakeCase(str) {
  return str
    .replace(/([A-Z])/g, '_$1')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
    .replace(/^_/, '');
}

function singular(word) {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

function log(msg) { console.log(msg); }
function dryLog(msg) { if (DRY_RUN) console.log('[DRY-RUN]', msg); }

function writeFile(filePath, content) {
  if (DRY_RUN) {
    dryLog(`Would write: ${filePath.replace(SDK_ROOT + '/', '')}`);
    return;
  }
  writeFileSync(filePath, content, 'utf-8');
}

// ─── Method name derivation ───────────────────────────────────────────────────

/**
 * Derive a camelCase method name from HTTP method + path + module prefix context.
 *
 * Strategy:
 * 1. Split path into all segments; track whether last is a {param}
 * 2. Strip module prefix segments from static segments
 * 3. Apply verb from HTTP method and remaining action segments
 */
function deriveMethodName(httpMethod, rawPath, modulePrefixes) {
  const method = httpMethod.toUpperCase();

  // All raw segments
  const allSegs = rawPath.replace(/^\/v1\//, '').replace(/^\/sdk\//, '').split('/').filter(Boolean);

  // Last segment tells us if operation targets a specific item
  const hasTrailingParam = allSegs.length > 0 && allSegs[allSegs.length - 1].startsWith('{');

  // Static segments only (no {param})
  const staticSegs = allSegs.filter(s => !s.startsWith('{'));
  const lastOriginalStatic = staticSegs[staticSegs.length - 1] || '';

  // Strip module-context prefix from the front of static segments
  let actionSegs = [...staticSegs];
  for (const p of modulePrefixes) {
    if (actionSegs.length > 0 && toCamelCase(actionSegs[0]) === toCamelCase(p)) {
      actionSegs = actionSegs.slice(1);
    }
  }

  const last = actionSegs[actionSegs.length - 1] || '';

  // ── Special last-segment patterns ──────────────────────────────────────────

  // .../new → create{SubResource}
  if (last === 'new' && ['POST', 'PUT'].includes(method)) {
    const resource = actionSegs.length >= 2
      ? singular(actionSegs[actionSegs.length - 2])
      : singular(modulePrefixes[modulePrefixes.length - 1] || 'Resource');
    return 'create' + toPascalCase(resource);
  }

  // POST .../update (literal update suffix)
  if (last === 'update' && method === 'POST') {
    const resource = actionSegs.length >= 2
      ? singular(actionSegs[actionSegs.length - 2])
      : singular(modulePrefixes[modulePrefixes.length - 1] || 'Resource');
    return 'update' + toPascalCase(resource);
  }

  // Compound update-xxx → updateXxx
  if (last.startsWith('update-') && last.length > 7) {
    return 'update' + toPascalCase(last.slice(7));
  }

  // ── No action segments (operation is on the root resource) ─────────────────
  if (actionSegs.length === 0) {
    const resource = toPascalCase(singular(modulePrefixes[modulePrefixes.length - 1] || 'Resource'));

    if (method === 'GET') {
      // Collection listing (no trailing param, last static was plural) → list
      if (!hasTrailingParam && lastOriginalStatic.endsWith('s') && !lastOriginalStatic.endsWith('ss')) {
        return 'list' + toPascalCase(lastOriginalStatic);
      }
      return 'get' + resource;
    }
    if (method === 'DELETE') return 'delete' + resource;
    if (method === 'POST') {
      return hasTrailingParam ? 'update' + resource : 'create' + resource;
    }
    if (method === 'PATCH') return 'update' + resource;
    if (method === 'PUT')   return 'replace' + resource;
    return method.toLowerCase() + resource;
  }

  // ── Action segments present ─────────────────────────────────────────────────

  if (method === 'DELETE') return 'delete' + toPascalCase(singular(last));

  if (method === 'GET') {
    if (hasTrailingParam) {
      // Fetching a specific item — use singular form
      return 'get' + toPascalCase(singular(last));
    }
    // Words ending in -us/-is/-os are grammatically singular (status, nexus, etc.)
    const isTrulyPlural = last.endsWith('s') && !last.endsWith('ss')
      && !last.endsWith('us') && !last.endsWith('is') && !last.endsWith('os');
    if (isTrulyPlural) {
      // Include parent context when listing a sub-resource to avoid name clashes
      // e.g. GET /admin/workspaces/{id}/users → listWorkspaceUsers, not listUsers
      if (actionSegs.length >= 2) {
        const parentCtx = toPascalCase(singular(actionSegs[actionSegs.length - 2]));
        return 'list' + parentCtx + toPascalCase(last);
      }
      return 'list' + toPascalCase(last);
    }
    return 'get' + toPascalCase(last);
  }

  if (method === 'PATCH') return 'update' + toPascalCase(singular(last));
  if (method === 'PUT')   return 'replace' + toPascalCase(singular(last));

  // POST to a simple plural collection (no hyphen, no trailing param) → createSingular
  if (method === 'POST' && !hasTrailingParam && actionSegs.length === 1
      && !last.includes('-') && last.endsWith('s') && !last.endsWith('ss')
      && !last.endsWith('us') && !last.endsWith('is')) {
    return 'create' + toPascalCase(singular(last));
  }

  // POST/unknown: camelCase all action segments, optionally disambiguate with path param context
  if (['POST', 'PUT', 'PATCH'].includes(method) && hasTrailingParam) {
    const allParams = (rawPath.match(/\{([^}]+)\}/g) || []).map(s => s.slice(1, -1));
    const lastParam = allParams[allParams.length - 1] || '';
    const genericParams = ['id', 'uuid', 'slug', 'key', 'workspaceid', 'workspaceslug',
                           'threadslug', 'embeduuid', 'sessionuuid', 'exposureid',
                           'docname', 'servername', 'toolname'];
    if (!genericParams.includes(lastParam.toLowerCase())) {
      // Non-generic param → incorporate it as disambiguation suffix
      const suffix = toPascalCase(lastParam.replace(/Id$|Uuid$|Slug$|Key$|Name$/, '') || lastParam);
      if (suffix) return toCamelCase(actionSegs.join('-')) + suffix;
    }
    // POST with generic trailing param to a plural resource → update{Singular}
    if (last.endsWith('s') && !last.endsWith('ss')) {
      return 'update' + toPascalCase(singular(last));
    }
  }

  return toCamelCase(actionSegs.join('-'));
}

// ─── Path parameter extraction ────────────────────────────────────────────────

function extractPathParams(path) {
  const matches = path.match(/\{([^}]+)\}/g) || [];
  return matches.map(m => m.slice(1, -1));
}

function buildTsParams(pathParams, hasBody, isUpload = false) {
  const parts = pathParams.map(p => `${toCamelCase(p)}: string`);
  if (isUpload) parts.push('form: FormData');
  else if (hasBody) parts.push('body?: Record<string, unknown>');
  return parts.join(', ');
}

function buildPyParams(pathParams, hasBody, isUpload = false) {
  const parts = ['self', ...pathParams.map(p => `${toSnakeCase(p)}: str`)];
  if (isUpload) parts.push('files: dict');
  else if (hasBody) parts.push('body: dict | None = None');
  return parts.join(', ');
}

function buildTsPathArg(rawPath, pathParams) {
  let p = rawPath;
  for (const param of pathParams) {
    p = p.replace(`{${param}}`, '${' + toCamelCase(param) + '}');
  }
  return p;
}

function buildPyPathArg(rawPath, pathParams) {
  let p = rawPath;
  for (const param of pathParams) {
    p = p.replace(`{${param}}`, '{' + toSnakeCase(param) + '}');
  }
  return p;
}

// ─── TypeScript module renderer ───────────────────────────────────────────────

function renderTsModule(tag, ops, cfg, digest) {
  const methods = ops.map(op => renderTsMethod(op, cfg)).join('\n\n');

  return `// AUTO-GENERATED from openapi.json — do not edit this file directly.
// Re-run: node scripts/generate-v1-sdk.mjs
// Spec digest: ${digest}
// Tag: ${tag}

import { DeveloperApiClient } from '../client';

export class ${cfg.cls} {
    constructor(private readonly client: DeveloperApiClient) {}
${methods}
}
`;
}

function renderTsMethod(op, cfg) {
  const { method, path, description } = op;
  const pathParams = extractPathParams(path);
  const hasBody = ['post', 'put', 'patch'].includes(method.toLowerCase()) && op.hasBody;
  const isStreaming = STREAMING_PATHS.has(path);
  const isUpload = UPLOAD_PATHS.has(path);

  const methodName = deriveMethodName(method, path, cfg.prefix);
  const tsParams = buildTsParams(pathParams, hasBody, isUpload);
  const pathArg = buildTsPathArg(path, pathParams);

  const jsDoc = description
    ? `    /**\n     * ${description.replace(/\n/g, '\n     * ')}\n     * @see ${method.toUpperCase()} ${path}\n     */`
    : `    /** @see ${method.toUpperCase()} ${path} */`;

  if (isStreaming) {
    return `${jsDoc}
    // @streaming-stub — implement SSE parsing in overrides/${cfg.ts}Streaming.ts
    async ${methodName}(${tsParams}): Promise<Response> {
        return this.client.requestRaw('${method.toUpperCase()}', \`${pathArg}\`${hasBody ? ', body' : ''});
    }`;
  }

  if (isUpload) {
    return `${jsDoc}
    // @upload-stub — multipart upload; wire form manually or use helper
    async ${methodName}(${tsParams}): Promise<unknown> {
        return this.client.requestMultipart('${method.toUpperCase()}', \`${pathArg}\`, form);
    }`;
  }

  const bodyArg = hasBody ? ', body' : '';
  const returnType = 'Promise<unknown>';

  return `${jsDoc}
    async ${methodName}(${tsParams}): ${returnType} {
        return this.client.request('${method.toUpperCase()}', \`${pathArg}\`${bodyArg});
    }`;
}

// ─── Python module renderer ───────────────────────────────────────────────────

function renderPyModule(tag, ops, cfg, digest) {
  const methods = ops.map(op => renderPyMethod(op, cfg)).join('\n\n');

  return `# AUTO-GENERATED from openapi.json — do not edit this file directly.
# Re-run: node scripts/generate-v1-sdk.mjs
# Spec digest: ${digest}
# Tag: ${tag}

from __future__ import annotations
from typing import Any, Optional
from ..client import DeveloperApiClient


class ${cfg.cls}:
    def __init__(self, client: DeveloperApiClient) -> None:
        self._client = client

${methods}
`;
}

function renderPyMethod(op, cfg) {
  const { method, path, description } = op;
  const pathParams = extractPathParams(path);
  const hasBody = ['post', 'put', 'patch'].includes(method.toLowerCase()) && op.hasBody;
  const isStreaming = STREAMING_PATHS.has(path);
  const isUpload = UPLOAD_PATHS.has(path);

  const methodNameTs = deriveMethodName(method, path, cfg.prefix);
  const methodName = toSnakeCase(methodNameTs);
  const pyParams = buildPyParams(pathParams, hasBody, isUpload);
  const pathArg = buildPyPathArg(path, pathParams);

  const docLine = description
    ? `        """${description.split('\n')[0]}  ${method.toUpperCase()} ${path}"""`
    : `        """${method.toUpperCase()} ${path}"""`;

  const paramFill = pathParams.map(p => `${toSnakeCase(p)}=${toSnakeCase(p)}`).join(', ');
  const pathExpr = pathParams.length > 0 ? `f"${pathArg}"` : `"${pathArg}"`;

  if (isStreaming) {
    return `    # @streaming-stub — implement SSE parsing in overrides/${cfg.py}_streaming.py
    async def ${methodName}(${pyParams}) -> Any:
${docLine}
        return await self._client.request("${method.toUpperCase()}", ${pathExpr}${hasBody ? ', json=body' : ''})`;
  }

  if (isUpload) {
    return `    # @upload-stub — multipart upload
    async def ${methodName}(${pyParams}) -> Any:
${docLine}
        return await self._client.request_multipart("${method.toUpperCase()}", ${pathExpr}, files=files)`;
  }

  const bodyArg = hasBody ? ', json=body' : '';

  return `    async def ${methodName}(${pyParams}) -> Any:
${docLine}
        return await self._client.request("${method.toUpperCase()}", ${pathExpr}${bodyArg})`;
}

// ─── Namespace updater ────────────────────────────────────────────────────────

const IMPORT_REGION  = ['// [GENERATED-IMPORTS-START]',  '// [GENERATED-IMPORTS-END]'];
const PROP_REGION    = ['// [GENERATED-PROPS-START]',    '// [GENERATED-PROPS-END]'];
const INIT_REGION    = ['// [GENERATED-INIT-START]',     '// [GENERATED-INIT-END]'];

function replaceRegion(content, [start, end], replacement) {
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1) return content + '\n' + replacement;
  return content.slice(0, startIdx + start.length) + '\n' + replacement + '\n' + content.slice(endIdx);
}

function updateNamespace(modules) {
  let content = readFileSync(TS_NAMESPACE, 'utf-8');

  const imports = modules
    .map(({ ts, cls }) => `import { ${cls} } from './modules/${ts}';`)
    .join('\n');

  const props = modules
    .map(({ cls, prop }) => `    public ${prop}: ${cls};`)
    .join('\n');

  const inits = modules
    .map(({ cls, prop }) => `        this.${prop} = new ${cls}(this._client);`)
    .join('\n');

  // Replace existing commented-out generated sections or add new region markers
  if (!content.includes(IMPORT_REGION[0])) {
    // First time: insert region markers after the last existing import comment block
    const insertAfter = '// --- Generated module imports (added by generate-v1-sdk.mjs) ---\n';
    const before = content.includes(insertAfter) ? insertAfter : "import { DeveloperApiClient } from './client';\n";
    content = content.replace(
      before,
      before + `${IMPORT_REGION[0]}\n${IMPORT_REGION[1]}\n`
    );
  }
  if (!content.includes(PROP_REGION[0])) {
    const insertAfter = '// --- Generated module properties (added by generate-v1-sdk.mjs) ---\n';
    const before = content.includes(insertAfter) ? insertAfter : '    readonly _client: DeveloperApiClient;\n';
    content = content.replace(
      before,
      before + `${PROP_REGION[0]}\n${PROP_REGION[1]}\n`
    );
  }
  if (!content.includes(INIT_REGION[0])) {
    const insertAfter = '// --- Generated module initialisation (added by generate-v1-sdk.mjs) ---\n';
    const before = content.includes(insertAfter) ? insertAfter : '        this._client = new DeveloperApiClient(baseUrl, apiKey);\n';
    content = content.replace(
      before,
      before + `${INIT_REGION[0]}\n${INIT_REGION[1]}\n`
    );
  }

  content = replaceRegion(content, IMPORT_REGION, imports);
  content = replaceRegion(content, PROP_REGION, props);
  content = replaceRegion(content, INIT_REGION, inits);

  writeFile(TS_NAMESPACE, content);
}

// ─── v1/index.ts updater ──────────────────────────────────────────────────────

const INDEX_REGION = ['// [GENERATED-MODULE-EXPORTS-START]', '// [GENERATED-MODULE-EXPORTS-END]'];

function updateTsIndex(modules) {
  let content = readFileSync(TS_V1_INDEX, 'utf-8');

  const exports = modules
    .map(({ ts, cls }) => `export { ${cls} } from './modules/${ts}';`)
    .join('\n');

  if (!content.includes(INDEX_REGION[0])) {
    content += `\n${INDEX_REGION[0]}\n${INDEX_REGION[1]}\n`;
  }

  content = replaceRegion(content, INDEX_REGION, exports);
  writeFile(TS_V1_INDEX, content);
}

// ─── Python __init__.py updater ───────────────────────────────────────────────

const PY_IMPORT_REGION = ['# [GENERATED-IMPORTS-START]', '# [GENERATED-IMPORTS-END]'];
const PY_ALL_REGION    = ['# [GENERATED-ALL-START]',     '# [GENERATED-ALL-END]'];

function updatePyInit(modules) {
  let content = readFileSync(PY_INIT, 'utf-8');

  const imports = modules
    .map(({ py, cls }) => `from .${py} import ${cls}`)
    .join('\n');

  const allEntries = modules
    .map(({ cls }) => `    "${cls}",`)
    .join('\n');

  if (!content.includes(PY_IMPORT_REGION[0])) {
    content += `\n${PY_IMPORT_REGION[0]}\n${PY_IMPORT_REGION[1]}\n`;
  }
  if (!content.includes(PY_ALL_REGION[0])) {
    // Insert before closing bracket of __all__ or append
    const allClose = content.lastIndexOf(']');
    if (allClose !== -1) {
      content = content.slice(0, allClose) + `    ${PY_ALL_REGION[0]}\n    ${PY_ALL_REGION[1]}\n` + content.slice(allClose);
    } else {
      content += `\n${PY_ALL_REGION[0]}\n${PY_ALL_REGION[1]}\n`;
    }
  }

  content = replaceRegion(content, PY_IMPORT_REGION, imports);
  content = replaceRegion(content, PY_ALL_REGION, allEntries);
  writeFile(PY_INIT, content);
}

// ─── Python namespace.py updater ─────────────────────────────────────────────

const PY_NS_IMPORT_REGION = ['# [GENERATED-IMPORTS-START]', '# [GENERATED-IMPORTS-END]'];
const PY_NS_INIT_REGION   = ['# [GENERATED-INIT-START]',    '# [GENERATED-INIT-END]'];

function updatePyNamespace(modules) {
  const nsPath = resolve(PY_V1_DIR, 'namespace.py');
  let content = readFileSync(nsPath, 'utf-8');

  const imports = modules
    .map(({ py, cls }) => `from .${py} import ${cls}`)
    .join('\n');

  const inits = modules
    .map(({ cls, prop }) => `        self.${prop} = ${cls}(self._client)`)
    .join('\n');

  // Add region markers if missing
  if (!content.includes(PY_NS_IMPORT_REGION[0])) {
    content = content.replace(
      'from .client import DeveloperApiClient\n',
      `from .client import DeveloperApiClient\n\n${PY_NS_IMPORT_REGION[0]}\n${PY_NS_IMPORT_REGION[1]}\n`
    );
  }
  if (!content.includes(PY_NS_INIT_REGION[0])) {
    content = content.replace(
      '        self._client = DeveloperApiClient(base_url, api_key)\n',
      `        self._client = DeveloperApiClient(base_url, api_key)\n\n        ${PY_NS_INIT_REGION[0]}\n        ${PY_NS_INIT_REGION[1]}\n`
    );
  }

  content = replaceRegion(content, PY_NS_IMPORT_REGION, imports);
  content = replaceRegion(content, PY_NS_INIT_REGION, inits.split('\n').map(l => l).join('\n'));
  writeFile(nsPath, content);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // 1. Load spec
  if (!existsSync(SPEC_PATH)) {
    console.error(`ERROR: openapi.json not found at ${SPEC_PATH}`);
    console.error('Run `yarn swagger` in the server directory first.');
    process.exit(1);
  }

  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf-8'));
  const allPaths = spec.paths || {};

  // 2. Filter to v1-only paths and compute digest
  const v1Paths = Object.fromEntries(
    Object.entries(allPaths).filter(([p]) => p.startsWith('/v1/'))
  );
  const digest = createHash('sha256')
    .update(JSON.stringify(v1Paths))
    .digest('hex')
    .slice(0, 16);

  // 3. Digest check (idempotency)
  if (!FORCE && !DRY_RUN && existsSync(DIGEST_FILE)) {
    const stored = JSON.parse(readFileSync(DIGEST_FILE, 'utf-8'));
    if (stored.sha256 === digest) {
      log('No spec changes detected. Use --force to regenerate.');
      return;
    }
  }

  // 4. Group operations by effective tag
  const tagOps = {}; // tag → Op[]

  for (const [rawPath, methods] of Object.entries(v1Paths)) {
    // Skip malformed paths (from swagger-autogen parse failures)
    if (!rawPath.startsWith('/v1/')) continue;
    if (rawPath.includes('{') && !rawPath.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/)) continue;

    for (const [method, op] of Object.entries(methods)) {
      if (typeof op !== 'object') continue;

      let tag = (op.tags || [])[0] || 'Untagged';

      // Skip SDK-internal tags
      if (SKIP_TAGS.has(tag)) continue;

      // Auto-tag untagged paths
      if (tag === 'Untagged') {
        tag = null;
        for (const [prefix, autoTag] of AUTO_TAG_RULES) {
          if (rawPath.startsWith(prefix)) { tag = autoTag; break; }
        }
        if (!tag) continue; // unrecognised — skip
      }

      if (!tagOps[tag]) tagOps[tag] = [];
      tagOps[tag].push({
        method,
        path: rawPath,
        description: op.description || op.summary || '',
        hasBody: !!op.requestBody,
        params: op.parameters || [],
      });
    }
  }

  log(`Found ${Object.keys(tagOps).length} modules to generate from ${Object.keys(v1Paths).length} v1 paths`);

  // 5. Ensure output dirs exist
  if (!DRY_RUN) {
    mkdirSync(TS_MODULES_DIR, { recursive: true });
  }

  // 6. Generate module files
  const generatedModules = []; // { ts, py, cls, prop }

  for (const [tag, ops] of Object.entries(tagOps)) {
    const cfg = TAG_CONFIG[tag];
    if (!cfg) {
      log(`  WARN: No config for tag "${tag}" — skipping`);
      continue;
    }

    // Check for @manual-override
    const tsPath = resolve(TS_MODULES_DIR, `${cfg.ts}.ts`);
    const pyPath = resolve(PY_V1_DIR, `${cfg.py}.py`);

    const tsOverride = existsSync(tsPath) && readFileSync(tsPath, 'utf-8').startsWith('// @manual-override');
    const pyOverride = existsSync(pyPath) && readFileSync(pyPath, 'utf-8').startsWith('# @manual-override');

    if (!tsOverride) {
      const tsContent = renderTsModule(tag, ops, cfg, digest);
      if (DRY_RUN) {
        dryLog(`Would write: typescript/src/v1/modules/${cfg.ts}.ts (${ops.length} methods)`);
        ops.forEach(op => {
          const name = deriveMethodName(op.method, op.path, cfg.prefix);
          const flag = STREAMING_PATHS.has(op.path) ? ' [STREAMING]' : UPLOAD_PATHS.has(op.path) ? ' [UPLOAD]' : '';
          dryLog(`  ${op.method.toUpperCase()} ${op.path} → ${name}()${flag}`);
        });
      } else {
        writeFile(tsPath, tsContent);
        log(`  ✔ typescript/src/v1/modules/${cfg.ts}.ts (${ops.length} methods)`);
      }
    } else {
      log(`  SKIP (manual-override): typescript/src/v1/modules/${cfg.ts}.ts`);
    }

    if (!pyOverride) {
      const pyContent = renderPyModule(tag, ops, cfg, digest);
      if (DRY_RUN) {
        dryLog(`Would write: python/realtimex_sdk/v1/${cfg.py}.py (${ops.length} methods)`);
      } else {
        writeFile(pyPath, pyContent);
        log(`  ✔ python/realtimex_sdk/v1/${cfg.py}.py (${ops.length} methods)`);
      }
    } else {
      log(`  SKIP (manual-override): python/realtimex_sdk/v1/${cfg.py}.py`);
    }

    generatedModules.push(cfg);
  }

  if (generatedModules.length === 0) {
    log('No modules generated.');
    return;
  }

  // 7. Update namespace, index, and Python __init__
  log('\nUpdating namespace and barrel exports...');
  if (!DRY_RUN) {
    updateNamespace(generatedModules);
    updateTsIndex(generatedModules);
    updatePyInit(generatedModules);
    updatePyNamespace(generatedModules);

    // 8. Write digest
    writeFileSync(DIGEST_FILE, JSON.stringify({
      sha256: digest,
      path_count: Object.keys(v1Paths).length,
      module_count: generatedModules.length,
      generated_at: new Date().toISOString(),
      spec_path: SPEC_PATH,
    }, null, 2), 'utf-8');

    log(`\n✔ Done — ${generatedModules.length} modules generated. Digest: ${digest}`);
    log('Next: run `npm run build` in typescript/ to compile.');
  } else {
    dryLog(`Would update: typescript/src/v1/namespace.ts`);
    dryLog(`Would update: typescript/src/v1/index.ts`);
    dryLog(`Would update: python/realtimex_sdk/v1/__init__.py`);
    dryLog(`Would update: python/realtimex_sdk/v1/namespace.py`);
    dryLog(`Would write: scripts/.sdk-spec-digest.json`);
    dryLog(`\nSummary: ${generatedModules.length} modules would be generated.`);
  }
}

main();
