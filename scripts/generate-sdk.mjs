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

function selectJsonSchema(content = {}) {
  if (!content || typeof content !== 'object') return null;
  return (
    content['application/json']?.schema ||
    content['application/*+json']?.schema ||
    Object.values(content).find((entry) => entry?.schema)?.schema ||
    null
  );
}

function selectSuccessResponseSchema(operation) {
  const responses = operation.responses || {};
  const preferredStatus = ['200', '201', '202', '204', 'default'].find(
    (status) => responses[status]
  );
  const response = preferredStatus ? responses[preferredStatus] : null;
  return selectJsonSchema(response?.content);
}

function selectRequestBodySchema(operation) {
  return selectJsonSchema(operation.requestBody?.content);
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
      const pathParams = params.filter((param) => param.in === 'path');
      const queryParams = params.filter((param) => param.in === 'query');
      const headerParams = params.filter((param) => param.in === 'header');
      operations.push({
        name: operationName(method, pathname, operation, usedNames),
        method: method.toUpperCase(),
        pathname: sdkPathname,
        summary: operation.summary || operation.description || '',
        pathParams: pathParams.map((param) => param.name),
        queryParams: queryParams.map((param) => param.name),
        headerParams: headerParams.map((param) => param.name),
        parameterSchemas: {
          path: pathParams,
          query: queryParams,
          header: headerParams,
        },
        requestBodySchema: selectRequestBodySchema(operation),
        responseBodySchema: selectSuccessResponseSchema(operation),
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
  ${operation.name}(...args) {
    return this.request(
      ${JSON.stringify(operation.name)},
      normalizeOperationOptions(operations[${JSON.stringify(operation.name)}], args)
    );
  }
`
    )
    .join('');

  return `'use strict';

const crypto = require('node:crypto');

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

class RealtimeXWebhookError extends Error {
  constructor(message, response = null, body = null, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RealtimeXWebhookError';
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

function normalizeWebhookEndpointUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(
      'RealtimeX webhook URL is unavailable; pass { endpointUrl } or set REALTIMEX_WEBHOOK_URL.'
    );
  }
  const parsed = new URL(normalized);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('RealtimeX webhook URL must use http or https.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('RealtimeX webhook URL must not contain embedded credentials.');
  }
  return parsed.toString();
}

function normalizeRetryCount(value, fallback = 2) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) return fallback;
  return parsed;
}

function normalizeTimeout(value, fallback = 15000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 120000);
}

function waitForRetry(delayMs, signal) {
  const delay = Math.max(0, Number(delayMs) || 0);
  if (delay === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (signal) signal.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(finish, delay);
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(signal.reason || new Error('Webhook request aborted.'));
    };
    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
    }
  });
}

function createAttemptSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const abortFromExternal = () => {
    controller.abort(externalSignal.reason || new Error('Webhook request aborted.'));
  };
  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternal();
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }
  const timeout = setTimeout(
    () => controller.abort(new Error('Webhook request timed out.')),
    timeoutMs
  );
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abortFromExternal);
      }
    },
  };
}

class RealtimeXWebhookClient {
  constructor(options = {}) {
    const env = typeof process !== 'undefined' ? process.env || {} : {};
    this.endpointUrl = normalizeWebhookEndpointUrl(
      options.endpointUrl || options.url || env.REALTIMEX_WEBHOOK_URL
    );
    this.secret = String(options.secret || env.REALTIMEX_WEBHOOK_SECRET || '');
    if (!this.secret) {
      throw new Error(
        'RealtimeX webhook secret is unavailable; pass { secret } or set REALTIMEX_WEBHOOK_SECRET.'
      );
    }
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== 'function') {
      throw new Error('A fetch implementation is required. Use Node 18+ or pass { fetch }.');
    }
    this.signatureHeader =
      options.signatureHeader ||
      env.REALTIMEX_WEBHOOK_SIGNATURE_HEADER ||
      'X-Webhook-Signature-256';
    this.signaturePrefix =
      options.signaturePrefix ?? env.REALTIMEX_WEBHOOK_SIGNATURE_PREFIX ?? 'sha256=';
    this.timestampHeader =
      options.timestampHeader ||
      env.REALTIMEX_WEBHOOK_TIMESTAMP_HEADER ||
      'X-Webhook-Timestamp';
    this.deliveryIdHeader =
      options.deliveryIdHeader ||
      env.REALTIMEX_WEBHOOK_DELIVERY_ID_HEADER ||
      'X-Webhook-Id';
    this.eventTypeHeader =
      options.eventTypeHeader ||
      env.REALTIMEX_WEBHOOK_EVENT_TYPE_HEADER ||
      'X-Webhook-Event';
    this.sourceHeader =
      options.sourceHeader ||
      env.REALTIMEX_WEBHOOK_SOURCE_HEADER ||
      'X-Webhook-Source';
    this.defaultEventType =
      options.eventType || env.REALTIMEX_WEBHOOK_EVENT_TYPE || 'realtimex.task';
    this.defaultSource =
      options.source || env.REALTIMEX_WEBHOOK_SOURCE || 'local-app';
    this.defaultHeaders = { ...(options.headers || {}) };
    this.maxRetries = normalizeRetryCount(options.maxRetries, 2);
    const configuredRetryDelay = Number(options.retryDelayMs);
    this.retryDelayMs = Number.isFinite(configuredRetryDelay) && configuredRetryDelay >= 0
      ? configuredRetryDelay
      : 250;
    this.timeoutMs = normalizeTimeout(options.timeoutMs, 15000);
  }

  async trigger(payload, options = {}) {
    if (payload === undefined) {
      throw new Error('RealtimeX webhook payload is required.');
    }
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (serialized === undefined) {
      throw new Error('RealtimeX webhook payload is not JSON serializable.');
    }
    const body = Buffer.from(serialized, 'utf8');
    const deliveryId = String(options.deliveryId || crypto.randomUUID());
    const timestamp = String(
      options.timestamp || Math.floor(Date.now() / 1000)
    );
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(body)
      .digest('hex');
    const headers = {
      ...this.defaultHeaders,
      ...(options.headers || {}),
      'content-type': 'application/json',
      [this.signatureHeader]: String(this.signaturePrefix || '') + signature,
      [this.timestampHeader]: timestamp,
      [this.deliveryIdHeader]: deliveryId,
      [this.eventTypeHeader]: String(options.eventType || this.defaultEventType),
      [this.sourceHeader]: String(options.source || this.defaultSource),
    };
    const maxRetries = normalizeRetryCount(options.maxRetries, this.maxRetries);
    const retryDelayMs =
      options.retryDelayMs === undefined
        ? this.retryDelayMs
        : Math.max(0, Number(options.retryDelayMs) || 0);
    const timeoutMs = normalizeTimeout(options.timeoutMs, this.timeoutMs);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const attemptSignal = createAttemptSignal(options.signal, timeoutMs);
      try {
        const response = await this.fetch(this.endpointUrl, {
          method: 'POST',
          headers,
          body,
          signal: attemptSignal.signal,
        });
        const responseBody = await parseResponseBody(response);
        if (response.status >= 500 && attempt < maxRetries) {
          await waitForRetry(retryDelayMs * (attempt + 1), options.signal);
          continue;
        }
        if (!response.ok) {
          throw new RealtimeXWebhookError(
            'RealtimeX webhook request failed: ' +
              response.status +
              ' ' +
              response.statusText,
            response,
            responseBody
          );
        }
        return responseBody;
      } catch (error) {
        if (error instanceof RealtimeXWebhookError) throw error;
        if (options.signal && options.signal.aborted) {
          throw new RealtimeXWebhookError(
            'RealtimeX webhook request aborted.',
            null,
            null,
            error
          );
        }
        if (attempt >= maxRetries) {
          const timedOut = attemptSignal.signal.aborted;
          throw new RealtimeXWebhookError(
            timedOut
              ? 'RealtimeX webhook request timed out.'
              : 'RealtimeX webhook request failed: ' + (error.message || String(error)),
            null,
            null,
            error
          );
        }
        await waitForRetry(retryDelayMs * (attempt + 1), options.signal);
      } finally {
        attemptSignal.cleanup();
      }
    }
    throw new RealtimeXWebhookError('RealtimeX webhook request failed.');
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLowLevelRequestOptions(value) {
  return isPlainObject(value) && (
    Object.prototype.hasOwnProperty.call(value, 'params') ||
    Object.prototype.hasOwnProperty.call(value, 'query') ||
    Object.prototype.hasOwnProperty.call(value, 'headers') ||
    Object.prototype.hasOwnProperty.call(value, 'body') ||
    Object.prototype.hasOwnProperty.call(value, 'signal')
  );
}

function mergeRequestOptions(base, overrides) {
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    params: { ...(base.params || {}), ...(overrides.params || {}) },
    query: { ...(base.query || {}), ...(overrides.query || {}) },
    headers: { ...(base.headers || {}), ...(overrides.headers || {}) },
  };
}

function normalizeOperationOptions(operation, args) {
  if (!args || args.length === 0) return {};

  const [first, second, third] = args;
  if (isLowLevelRequestOptions(first)) {
    return mergeRequestOptions(first, second);
  }

  const options = {};

  if (operation.hasBody) {
    if (operation.pathParams.length === 1 && args.length >= 2 && !isPlainObject(first)) {
      options.params = { [operation.pathParams[0]]: first };
      options.body = second;
      return mergeRequestOptions(options, third);
    }
    if (operation.pathParams.length > 0 && args.length >= 2) {
      options.params = first || {};
      options.body = second;
      return mergeRequestOptions(options, third);
    }
    options.body = first;
  } else if (operation.pathParams.length === 1 && !isPlainObject(first)) {
    options.params = { [operation.pathParams[0]]: first };
  } else if (operation.pathParams.length > 0) {
    options.params = first || {};
  } else if (operation.queryParams.length > 0) {
    options.query = first || {};
  } else if (isPlainObject(first)) {
    options.query = first;
  }

  return mergeRequestOptions(options, second);
}

class RealtimeXClient {
  constructor(options = {}) {
    const env = typeof process !== 'undefined' ? process.env || {} : {};
    this.baseUrl = options.baseUrl || env.REALTIMEX_BASE_URL;
    if (!this.baseUrl) {
      throw new Error(
        'RealtimeX SDK base URL is unavailable; pass { baseUrl } or propagate REALTIMEX_BASE_URL.'
      );
    }
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

function createRealtimeXWebhookClient(options = {}) {
  return new RealtimeXWebhookClient(options);
}

module.exports = {
  RealtimeXApiError,
  RealtimeXClient,
  RealtimeXWebhookClient,
  RealtimeXWebhookError,
  createClient: createRealtimeXClient,
  createRealtimeXClient,
  createRealtimeXWebhookClient,
  operations,
  version: ${JSON.stringify(metadata.version)},
};
`;
}

function toTypeName(value, fallback = 'GeneratedType') {
  const identifier = toIdentifier(value, fallback);
  const pascal = identifier.charAt(0).toUpperCase() + identifier.slice(1);
  return /^[A-Za-z_$]/.test(pascal) ? pascal : fallback;
}

function quotePropertyName(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function refToType(ref = '') {
  return toTypeName(ref.split('/').pop() || 'ReferencedSchema');
}

function schemaToTs(schema, fallback = 'unknown') {
  if (!schema || typeof schema !== 'object') return fallback;
  if (schema.$ref) return refToType(schema.$ref);
  if (schema.nullable) {
    return `${schemaToTs({ ...schema, nullable: false }, fallback)} | null`;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf.map((entry) => schemaToTs(entry, fallback)).join(' | ');
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return schema.anyOf.map((entry) => schemaToTs(entry, fallback)).join(' | ');
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.map((entry) => schemaToTs(entry, fallback)).join(' & ');
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type].filter(Boolean);
  if (types.includes('array')) {
    return `Array<${schemaToTs(schema.items, 'unknown')}>`;
  }
  if (types.includes('object') || schema.properties || schema.additionalProperties) {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const properties = schema.properties || {};
    const lines = Object.entries(properties).map(([name, propSchema]) => {
      const optional = required.has(name) ? '' : '?';
      return `  ${quotePropertyName(name)}${optional}: ${schemaToTs(propSchema, 'unknown')};`;
    });
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      lines.push(`  [key: string]: ${schemaToTs(schema.additionalProperties, 'unknown')};`);
    } else if (schema.additionalProperties !== false && lines.length === 0) {
      return 'Record<string, unknown>';
    }
    return lines.length > 0 ? `{\n${lines.join('\n')}\n}` : 'Record<string, unknown>';
  }
  if (types.includes('integer') || types.includes('number')) return 'number';
  if (types.includes('boolean')) return 'boolean';
  if (types.includes('string')) return 'string';
  return fallback;
}

function paramsToTs(parameters = []) {
  if (!Array.isArray(parameters) || parameters.length === 0) return 'Record<string, never>';
  const lines = parameters.map((param) => {
    const optional = param.required === true ? '' : '?';
    return `  ${quotePropertyName(param.name)}${optional}: ${schemaToTs(param.schema, 'unknown')};`;
  });
  return `{\n${lines.join('\n')}\n}`;
}

function operationTypeNames(operation) {
  const base = toTypeName(operation.name);
  return {
    options: `${base}Options`,
    params: `${base}Params`,
    query: `${base}Query`,
    headers: `${base}Headers`,
    body: `${base}Body`,
    response: `${base}Response`,
  };
}

function renderConvenienceSignature(operation, names) {
  const response = `Promise<${names.response}>`;
  const options = `${names.options}`;
  if (operation.hasBody) {
    if (operation.pathParams.length === 1) {
      const pathParam = operation.parameterSchemas.path[0];
      return `${operation.name}(${toIdentifier(pathParam.name)}: ${schemaToTs(pathParam.schema, 'unknown')}, body: ${names.body}, options?: Omit<${options}, 'params' | 'body'>): ${response};`;
    }
    if (operation.pathParams.length > 1) {
      return `${operation.name}(params: ${names.params}, body: ${names.body}, options?: Omit<${options}, 'params' | 'body'>): ${response};`;
    }
    return `${operation.name}(body: ${names.body}, options?: Omit<${options}, 'body'>): ${response};`;
  }
  if (operation.pathParams.length === 1) {
    const pathParam = operation.parameterSchemas.path[0];
    return `${operation.name}(${toIdentifier(pathParam.name)}: ${schemaToTs(pathParam.schema, 'unknown')}, options?: Omit<${options}, 'params'>): ${response};`;
  }
  if (operation.pathParams.length > 1) {
    return `${operation.name}(params: ${names.params}, options?: Omit<${options}, 'params'>): ${response};`;
  }
  if (operation.queryParams.length > 0) {
    return `${operation.name}(query?: ${names.query}, options?: Omit<${options}, 'query'>): ${response};`;
  }
  return null;
}

function renderIndexDts(spec, operations) {
  const componentTypes = Object.entries(spec.components?.schemas || {})
    .map(([name, schema]) => {
      return `export type ${toTypeName(name)} = ${schemaToTs(schema, 'unknown')};`;
    })
    .join('\n\n');

  const operationTypes = operations
    .map((operation) => {
      const names = operationTypeNames(operation);
      return [
        `export type ${names.params} = ${paramsToTs(operation.parameterSchemas.path)};`,
        `export type ${names.query} = ${paramsToTs(operation.parameterSchemas.query)};`,
        `export type ${names.headers} = ${paramsToTs(operation.parameterSchemas.header)};`,
        `export type ${names.body} = ${schemaToTs(operation.requestBodySchema, 'unknown')};`,
        `export type ${names.response} = ${schemaToTs(operation.responseBodySchema, 'unknown')};`,
        `export interface ${names.options} extends RealtimeXRequestOptions {`,
        `  params?: ${names.params};`,
        `  query?: ${names.query};`,
        `  headers?: ${names.headers} & Record<string, string>;`,
        `  body?: ${names.body};`,
        `}`,
      ].join('\n');
    })
    .join('\n\n');

  const methods = operations
    .map((operation) => {
      const names = operationTypeNames(operation);
      const summary = operation.summary
        ? `  /** ${operation.summary.replace(/\*\//g, '* /')} */\n`
        : '';
      const baseSignature = `${operation.name}(options?: ${names.options}): Promise<${names.response}>;`;
      const convenienceSignature = renderConvenienceSignature(operation, names);
      return `${summary}  ${baseSignature}\n${convenienceSignature ? `  ${convenienceSignature}\n` : ''}`;
    })
    .join('');

  return `${componentTypes ? `${componentTypes}\n\n` : ''}${operationTypes}

export interface RealtimeXClientOptions {
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

export interface RealtimeXWebhookClientOptions {
  endpointUrl?: string;
  url?: string;
  secret?: string;
  signatureHeader?: string;
  signaturePrefix?: string;
  timestampHeader?: string;
  deliveryIdHeader?: string;
  eventTypeHeader?: string;
  sourceHeader?: string;
  eventType?: string;
  source?: string;
  headers?: Record<string, string>;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface RealtimeXWebhookTriggerOptions {
  deliveryId?: string;
  timestamp?: string | number;
  eventType?: string;
  source?: string;
  headers?: Record<string, string>;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RealtimeXWebhookReceipt {
  success: boolean;
  accepted: boolean;
  duplicate: boolean;
  deliveryId: string;
  threadId: string | number | null;
  taskId: string | number | null;
  [key: string]: unknown;
}

export declare class RealtimeXApiError extends Error {
  status?: number;
  statusText?: string;
  body: unknown;
  response: Response;
}

export declare class RealtimeXWebhookError extends Error {
  status?: number;
  statusText?: string;
  body: unknown;
  response: Response | null;
}

export declare class RealtimeXWebhookClient {
  constructor(options?: RealtimeXWebhookClientOptions);
  trigger(
    payload: unknown,
    options?: RealtimeXWebhookTriggerOptions
  ): Promise<RealtimeXWebhookReceipt>;
}

export declare class RealtimeXClient {
  constructor(options?: RealtimeXClientOptions);
  request(operationName: string, options?: RealtimeXRequestOptions): Promise<unknown>;
${methods}}

export declare function createRealtimeXClient(
  options?: RealtimeXClientOptions
): RealtimeXClient;
export declare function createRealtimeXWebhookClient(
  options?: RealtimeXWebhookClientOptions
): RealtimeXWebhookClient;
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
fs.writeFileSync(path.join(outDir, 'index.d.ts'), renderIndexDts(spec, operations));

console.log(
  `[generate-sdk] generated ${operations.length} operations into ${path.relative(
    REPO_ROOT,
    outDir
  )}`
);
