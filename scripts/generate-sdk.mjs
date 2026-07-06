#!/usr/bin/env node
/**
 * Generate the CommonJS @realtimex/sdk runtime client from an OpenAPI spec.
 *
 * CI downloads the app-built OpenAPI artifact, then generates index.js and
 * index.d.ts before publishing the npm package. Generated output is not
 * committed on release branches.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SPEC = path.join(REPO_ROOT, 'openapi.json');
const DEFAULT_OUT = path.join(REPO_ROOT, 'typescript');

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    flags[key] = rest.length
      ? rest.join('=')
      : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return flags;
}

function toIdentifier(value, fallback = 'operation') {
  const raw = String(value || '').replace(/[^A-Za-z0-9_$]+/g, ' ').trim();
  const words = raw ? raw.split(/\s+/) : [fallback];
  const name =
    words
      .map((word, index) => {
        const clean = word
          .replace(/^[^A-Za-z_$]+/, '')
          .replace(/[^A-Za-z0-9_$]/g, '');
        if (!clean) return '';
        if (index === 0) return clean.charAt(0).toLowerCase() + clean.slice(1);
        return clean.charAt(0).toUpperCase() + clean.slice(1);
      })
      .join('') || fallback;
  return /^[A-Za-z_$]/.test(name) ? name : `${fallback}${name}`;
}

function operationName(method, pathname, operation, usedNames) {
  const base = operation.operationId || `${method} ${pathname}`;
  const baseName = toIdentifier(base);
  let name = baseName;
  let suffix = 2;
  while (usedNames.has(name)) {
    name = `${baseName}${suffix}`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
}

function normalizeParameters(pathItem, operation) {
  return [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ].filter((param) => param && param.name && param.in);
}

function stripPathPrefix(pathname, prefix) {
  if (!prefix || !pathname.startsWith(prefix)) return pathname;
  const stripped = pathname.slice(prefix.length);
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

function collectOperations(spec, options = {}) {
  const operations = [];
  const usedNames = new Set();
  const methods = new Set([
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'head',
    'options',
  ]);

  for (const [pathname, pathItem] of Object.entries(spec.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    const sdkPathname = stripPathPrefix(pathname, options.stripPathPrefix);
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method) || !operation || typeof operation !== 'object') {
        continue;
      }

      const params = normalizeParameters(pathItem, operation);
      operations.push({
        name: operationName(method, pathname, operation, usedNames),
        method: method.toUpperCase(),
        pathname: sdkPathname,
        summary: operation.summary || operation.description || '',
        pathParams: params
          .filter((param) => param.in === 'path')
          .map((param) => param.name),
        queryParams: params
          .filter((param) => param.in === 'query')
          .map((param) => param.name),
        headerParams: params
          .filter((param) => param.in === 'header')
          .map((param) => param.name),
        hasBody: Boolean(operation.requestBody),
      });
    }
  }

  return operations.sort((left, right) => left.name.localeCompare(right.name));
}

function renderIndexJs(operations, metadata) {
  const operationMap = Object.fromEntries(
    operations.map((operation) => [
      operation.name,
      {
        method: operation.method,
        path: operation.pathname,
        pathParams: operation.pathParams,
        queryParams: operation.queryParams,
        headerParams: operation.headerParams,
        hasBody: operation.hasBody,
      },
    ])
  );

  const methods = operations
    .map(
      (operation) => `
  ${operation.name}(options = {}) {
    return this.request(${JSON.stringify(operation.name)}, options);
  }
`
    )
    .join('');

  return `'use strict';

const operations = ${JSON.stringify(operationMap, null, 2)};

class RealtimeXApiError extends Error {
  constructor(message, response, body) {
    super(message);
    this.name = 'RealtimeXApiError';
    this.status = response && response.status;
    this.statusText = response && response.statusText;
    this.body = body;
    this.response = response;
  }
}

function joinUrl(baseUrl, pathname) {
  const base = String(baseUrl || '').replace(/\\/+$/g, '');
  const path = String(pathname || '').replace(/^\\/+/, '');
  return base + '/' + path;
}

function encodePath(pathname, params) {
  let encoded = pathname;
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null) continue;
    encoded = encoded.replace(
      new RegExp('\\\\{' + key + '\\\\}', 'g'),
      encodeURIComponent(String(value))
    );
  }
  return encoded;
}

function appendQuery(url, query) {
  const entries = Object.entries(query || {}).filter(([, value]) => value != null);
  if (entries.length === 0) return url;
  const parsed = new URL(url);
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      for (const item of value) parsed.searchParams.append(key, String(item));
    } else {
      parsed.searchParams.set(key, String(value));
    }
  }
  return parsed.toString();
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  const contentType =
    response.headers && response.headers.get
      ? response.headers.get('content-type') || ''
      : '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

class RealtimeXClient {
  constructor(options = {}) {
    const env = typeof process !== 'undefined' ? process.env || {} : {};
    this.baseUrl =
      options.baseUrl || env.REALTIMEX_BASE_URL || 'http://localhost:3101/cli';
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== 'function') {
      throw new Error('A fetch implementation is required. Use Node 18+ or pass { fetch }.');
    }

    this.defaultHeaders = { ...(options.headers || {}) };
    const appId = options.appId || options.appIdAuth || env.REALTIMEX_APP_ID_AUTH;
    const apiKey = options.apiKey || env.REALTIMEX_API_KEY;
    const token = options.token || env.REALTIMEX_AUTH_TOKEN;
    if (appId) this.defaultHeaders['x-app-id'] = appId;
    if (apiKey) this.defaultHeaders['x-api-key'] = apiKey;
    if (token) {
      this.defaultHeaders.Authorization = String(token).startsWith('Bearer ')
        ? token
        : 'Bearer ' + token;
    }
  }

  async request(operationName, options = {}) {
    const operation = operations[operationName];
    if (!operation) {
      throw new Error('Unknown RealtimeX SDK operation: ' + operationName);
    }

    const params = options.params || {};
    const query = { ...(options.query || {}) };
    for (const name of operation.queryParams) {
      if (params[name] !== undefined && query[name] === undefined) {
        query[name] = params[name];
      }
    }

    const headers = { ...this.defaultHeaders, ...(options.headers || {}) };
    for (const name of operation.headerParams) {
      if (params[name] !== undefined && headers[name] === undefined) {
        headers[name] = params[name];
      }
    }

    let url = joinUrl(this.baseUrl, encodePath(operation.path, params));
    url = appendQuery(url, query);

    const init = { method: operation.method, headers };
    if (options.signal) init.signal = options.signal;
    if (operation.hasBody || options.body !== undefined) {
      if (options.body !== undefined) {
        headers['content-type'] =
          headers['content-type'] || headers['Content-Type'] || 'application/json';
        init.body =
          typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      }
    }

    const response = await this.fetch(url, init);
    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new RealtimeXApiError(
        'RealtimeX API request failed: ' + response.status + ' ' + response.statusText,
        response,
        body
      );
    }
    return body;
  }
${methods}}

function createRealtimeXClient(options = {}) {
  return new RealtimeXClient(options);
}

module.exports = {
  RealtimeXApiError,
  RealtimeXClient,
  createClient: createRealtimeXClient,
  createRealtimeXClient,
  operations,
  version: ${JSON.stringify(metadata.version)},
};
`;
}

function renderIndexDts(operations) {
  const methods = operations
    .map((operation) => {
      const summary = operation.summary
        ? `  /** ${operation.summary.replace(/\*\//g, '* /')} */\n`
        : '';
      return `${summary}  ${operation.name}(options?: RealtimeXRequestOptions): Promise<unknown>;\n`;
    })
    .join('');

  return `export interface RealtimeXClientOptions {
  baseUrl?: string;
  appId?: string;
  appIdAuth?: string;
  apiKey?: string;
  token?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export interface RealtimeXRequestOptions {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export declare class RealtimeXApiError extends Error {
  status?: number;
  statusText?: string;
  body: unknown;
  response: Response;
}

export declare class RealtimeXClient {
  constructor(options?: RealtimeXClientOptions);
  request(operationName: string, options?: RealtimeXRequestOptions): Promise<unknown>;
${methods}}

export declare function createRealtimeXClient(
  options?: RealtimeXClientOptions
): RealtimeXClient;
export declare const createClient: typeof createRealtimeXClient;
export declare const operations: Record<
  string,
  {
    method: string;
    path: string;
    pathParams: string[];
    queryParams: string[];
    headerParams: string[];
    hasBody: boolean;
  }
>;
export declare const version: string;
`;
}

const flags = parseFlags(process.argv.slice(2));
const specPath = path.resolve(flags.spec || DEFAULT_SPEC);
const outDir = path.resolve(flags.out || DEFAULT_OUT);
const packagePath = path.join(outDir, 'package.json');
const stripPrefix =
  flags['strip-path-prefix'] === false || flags['strip-path-prefix'] === 'false'
    ? ''
    : String(flags['strip-path-prefix'] || '/cli');

if (!fs.existsSync(specPath)) {
  throw new Error(`OpenAPI spec not found: ${specPath}`);
}
if (!fs.existsSync(packagePath)) {
  throw new Error(`Package file not found: ${packagePath}`);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const operations = collectOperations(spec, { stripPathPrefix: stripPrefix });
if (operations.length === 0) {
  throw new Error(`No operations found in OpenAPI spec: ${specPath}`);
}

fs.writeFileSync(
  path.join(outDir, 'index.js'),
  renderIndexJs(operations, { version: pkg.version })
);
fs.writeFileSync(path.join(outDir, 'index.d.ts'), renderIndexDts(operations));

console.log(
  `[generate-sdk] generated ${operations.length} operations into ${path.relative(
    REPO_ROOT,
    outDir
  )}`
);
