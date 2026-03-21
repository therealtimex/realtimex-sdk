import { createHash, createHmac, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PermissionDeniedError } from './api';
import {
    ContractEventType,
    ContractCapability,
    ContractCapabilityInput,
    CompileCapabilitiesOptions,
    CompiledCapabilitiesResult,
    CapabilityMigrationWarning,
    ContractCapabilitySyncResponse,
    ContractInvokePayload,
    ContractPreflightHandlerOptions,
    ContractPreflightRequestBody,
    ContractInvokeRequestBody,
    ContractInvokeHandlerOptions,
    ContractInvokeHandlerInput,
    ContractPreflightResponsePayload,
    ContractInvokeResponsePayload,
    ContractHealthResponsePayload,
    ContractRouterHandlers,
    ContractSkillArtifact,
    ContractSkillAppIndex,
    ContractSkillMetadata,
    ContractSkillRootIndex,
    ContractBuildSkillArtifactsOptions,
    ContractBuildSkillArtifactsResult,
    ContractPublishSkillsResult,
    LocalAppContractDefinition,
    LocalAppContractResponse,
    LocalAppCapabilitiesResponse,
    LocalAppCapabilitySearchResponse,
    LocalAppCapabilityDetailResponse,
    TriggerAgentResponse,
} from '../types';

export const LOCAL_APP_CONTRACT_VERSION = 'local-app-contract/v1';
export const CONTRACT_SIGNATURE_HEADER = 'x-rtx-contract-signature';
export const CONTRACT_EVENT_ID_HEADER = 'x-rtx-event-id';
export const CONTRACT_SIGNATURE_ALGORITHM = 'sha256';
export const CONTRACT_ATTEMPT_PREFIX = 'run-';
const DEFAULT_CONTRACT_TRIGGER_ROUTE = '/webhooks/realtimex';
const DEFAULT_SKILL_PREFLIGHT_PATH = '/api/contracts/preflight';
const DEFAULT_SKILL_INVOKE_PATH = '/api/contracts/invoke';
const DEFAULT_SKILL_HEALTH_PATH = '/api/contracts/health';
const DEFAULT_SKILL_BASE_URL = 'http://127.0.0.1:<local_app_port>';
const INDEX_FILE = 'index.json';
const SKILL_FILE = 'SKILL.md';
const SKILL_METADATA_FILE = 'skill.json';

const CONTRACT_EVENT_ALIASES: Record<string, ContractEventType> = {
    'trigger-agent': 'task.trigger',
    'task.trigger': 'task.trigger',
    ping: 'system.ping',
    'system.ping': 'system.ping',
    claim: 'task.claimed',
    claimed: 'task.claimed',
    'task.claimed': 'task.claimed',
    'task-start': 'task.started',
    start: 'task.started',
    'task.started': 'task.started',
    'task-progress': 'task.progress',
    progress: 'task.progress',
    processing: 'task.progress',
    'task.progress': 'task.progress',
    'task-complete': 'task.completed',
    complete: 'task.completed',
    completed: 'task.completed',
    'task.completed': 'task.completed',
    'task-fail': 'task.failed',
    fail: 'task.failed',
    failed: 'task.failed',
    'task.failed': 'task.failed',
    'task-cancel': 'task.canceled',
    'task-cancelled': 'task.canceled',
    'task-canceled': 'task.canceled',
    cancel: 'task.canceled',
    cancelled: 'task.canceled',
    canceled: 'task.canceled',
    'task.canceled': 'task.canceled',
};

const CONTRACT_LEGACY_ACTIONS: Record<ContractEventType, string> = {
    'task.trigger': 'trigger-agent',
    'system.ping': 'ping',
    'task.claimed': 'claim',
    'task.started': 'start',
    'task.progress': 'progress',
    'task.completed': 'complete',
    'task.failed': 'fail',
    'task.canceled': 'cancel',
};

function normalizeToken(value = '', fallback = 'skill'): string {
    const normalized = String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/--+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || fallback;
}

function sanitizePathSegment(value = '', fallback = 'unknown'): string {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || fallback;
}

function asYamlString(value = ''): string {
    return JSON.stringify(String(value ?? ''));
}

function getLocalAppAgentSkillsRootDir(env: Record<string, string | undefined> = process.env): string {
    const override = String(env.LOCAL_APP_AGENT_SKILLS_DIR || '').trim();
    if (override) return path.resolve(override);
    return path.join(
        os.homedir(),
        '.realtimex.ai',
        'Resources',
        'agent-skills',
        'local-apps'
    );
}

function toAppDirectoryName(appId = ''): string {
    const candidate = String(appId || '').trim();
    if (/^[a-zA-Z0-9._-]{1,128}$/.test(candidate)) return candidate;
    const token = sanitizePathSegment(candidate, 'local-app');
    const suffix = createHash('sha1').update(candidate).digest('hex').slice(0, 8);
    return `${token}-${suffix}`;
}

function buildSkillName(input: {
    appId?: string;
    appName?: string;
    capabilityId?: string;
}): string {
    const appToken = normalizeToken(input.appName || input.appId, 'local-app');
    const capabilityToken = normalizeToken(input.capabilityId, 'capability');
    const base = normalizeToken(`${appToken}-${capabilityToken}`, 'local-app-skill');

    if (base.length <= 64) return base;
    const hash = createHash('sha1')
        .update(`${input.appId || ''}:${input.capabilityId || ''}`)
        .digest('hex')
        .slice(0, 8);
    return `${base.slice(0, 55).replace(/-+$/g, '')}-${hash}`.slice(0, 64);
}

function ensureDir(dirPath = ''): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeFileIfChanged(filePath = '', content = ''): boolean {
    if (fs.existsSync(filePath)) {
        const existing = fs.readFileSync(filePath, 'utf8');
        if (existing === content) return false;
    }
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
}

function listDirectoryNames(dirPath = ''): string[] {
    if (!fs.existsSync(dirPath)) return [];
    return fs
        .readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
}

function removeDirectory(dirPath = ''): boolean {
    if (!fs.existsSync(dirPath)) return false;
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
}

function removeFile(filePath = ''): boolean {
    if (!fs.existsSync(filePath)) return false;
    fs.rmSync(filePath, { force: true });
    return true;
}

function joinUrl(baseUrl: string, routePath: string): string {
    const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/g, '');
    const normalizedPath = String(routePath || '').trim();
    if (!normalizedPath) return normalizedBaseUrl;
    if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
    if (!normalizedBaseUrl) return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
    return `${normalizedBaseUrl}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}

function buildInputSummary(capability: ContractCapability): Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
}> {
    const schema = isRecord(capability.input_schema) ? capability.input_schema : {};
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(
        Array.isArray(schema.required)
            ? schema.required
                  .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                  .filter(Boolean)
            : []
    );

    const rows: Array<{
        name: string;
        type: string;
        required: boolean;
        description: string;
    }> = [];
    for (const [key, property] of Object.entries(properties)) {
        const record = isRecord(property) ? property : {};
        rows.push({
            name: key,
            type:
                typeof record.type === 'string' && record.type.trim()
                    ? record.type.trim()
                    : 'any',
            required: required.has(key),
            description:
                typeof record.description === 'string' && record.description.trim()
                    ? record.description.trim()
                    : '',
        });
    }

    if (rows.length === 0) {
        for (const key of required) {
            rows.push({
                name: key,
                type: 'any',
                required: true,
                description: '',
            });
        }
    }

    return rows;
}

function buildArgsTemplate(capability: ContractCapability): Record<string, unknown> {
    const schema = isRecord(capability.input_schema) ? capability.input_schema : {};
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    const args: Record<string, unknown> = {};

    for (const field of required) {
        if (typeof field !== 'string' || !field.trim()) continue;
        const key = field.trim();
        const property = isRecord(properties[key]) ? properties[key] : {};
        const type = typeof property.type === 'string' ? property.type.trim() : '';
        if (type === 'number' || type === 'integer') {
            args[key] = 0;
            continue;
        }
        if (type === 'boolean') {
            args[key] = false;
            continue;
        }
        if (type === 'array') {
            args[key] = [];
            continue;
        }
        if (type === 'object') {
            args[key] = {};
            continue;
        }
        args[key] = `<${key}>`;
    }

    return args;
}

function formatConfigurationEntry(entry: {
    key: string;
    description?: string;
    source?: string;
    sensitive?: boolean;
}): string {
    const flags: string[] = [];
    if (typeof entry.source === 'string' && entry.source.trim()) {
        flags.push(`source: ${entry.source.trim()}`);
    }
    if (entry.sensitive === true) flags.push('sensitive');
    const metadata = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    const description =
        typeof entry.description === 'string' && entry.description.trim()
            ? ` - ${entry.description.trim()}`
            : '';
    return `- \`${entry.key}\`${metadata}${description}`;
}

function hasRuntimeContextConfiguration(capability: ContractCapability): boolean {
    const configuration = capability.configuration;
    if (!configuration) return false;
    const entries = normalizeCapabilityConfigEntries([
        ...(Array.isArray(configuration.required) ? configuration.required : []),
        ...(Array.isArray(configuration.optional) ? configuration.optional : []),
    ]);
    return entries.some((entry) =>
        String(entry.source || '')
            .trim()
            .toLowerCase()
            .startsWith('runtime_context.')
    );
}

function buildPreflightRequestBody(capability: ContractCapability): Record<string, unknown> {
    return {
        capability_id: capability.capability_id,
        args: buildArgsTemplate(capability),
    };
}

function buildInvokeRequestBody(capability: ContractCapability): Record<string, unknown> {
    return {
        capability_id: capability.capability_id,
        args: buildArgsTemplate(capability),
        context: {
            workspace_id: '<runtime-provided>',
            thread_id: '<runtime-provided>',
            user_id: '<runtime-provided>',
        },
        contract: {
            contract_version: LOCAL_APP_CONTRACT_VERSION,
        },
    };
}

function buildSkillMarkdown(
    capability: ContractCapability,
    metadata: ContractSkillMetadata
): string {
    const capabilityName = capability.name || capability.capability_id || 'Capability';
    const description =
        typeof capability.description === 'string' && capability.description.trim()
            ? capability.description.trim()
            : `Invoke ${capabilityName}.`;
    const inputSummary = buildInputSummary(capability);
    const examples = Array.isArray(capability.examples) ? capability.examples : [];
    const requiredPreprocessing = resolveRequiredPreprocessing(capability);
    const lines = [
        '---',
        `name: ${metadata.name}`,
        `description: ${asYamlString(`${description} Use when the user asks to perform this action in ${metadata.app_name || metadata.app_id || 'the Local App'}.`)}`,
        `compatibility: ${asYamlString('Requires HTTP access to the Local App contract router.')}`,
        'metadata:',
        `  app_id: ${asYamlString(metadata.app_id || '')}`,
        `  app_name: ${asYamlString(metadata.app_name || '')}`,
        `  capability_id: ${asYamlString(metadata.capability_id || '')}`,
        `  contract_version: ${asYamlString(metadata.contract_version)}`,
        `  base_url: ${asYamlString(metadata.router.base_url)}`,
        `  preflight_url: ${asYamlString(metadata.router.preflight_url)}`,
        `  invoke_url: ${asYamlString(metadata.router.invoke_url)}`,
        `  health_url: ${asYamlString(metadata.router.health_url)}`,
        '---',
        '',
        `# ${capabilityName}`,
        '',
        `This skill invokes \`${capability.capability_id}\` through the Local App contract router for **${metadata.app_name || metadata.app_id || 'the Local App'}**.`,
        '',
        '## When To Use',
        '',
        `Use this skill when the user asks to perform a task handled by ${metadata.app_name || metadata.app_id || 'the Local App'}.`,
        '',
        '## Required Inputs',
        '',
    ];

    if (inputSummary.length === 0) {
        lines.push('- No explicit required fields were declared by the app.');
    } else {
        for (const row of inputSummary) {
            const requiredText = row.required ? 'required' : 'optional';
            const suffix = row.description ? ` - ${row.description}` : '';
            lines.push(`- \`${row.name}\` (${row.type}, ${requiredText})${suffix}`);
        }
    }

    if (capability.configuration) {
        const requiredConfiguration = normalizeCapabilityConfigEntries(
            capability.configuration.required
        );
        const optionalConfiguration = normalizeCapabilityConfigEntries(
            capability.configuration.optional
        );
        lines.push('');
        lines.push('## Configuration');
        lines.push('');
        lines.push('Resolve declared configuration requirements before invoke.');
        if (requiredConfiguration.length > 0) {
            lines.push('');
            lines.push('Required configuration:');
            for (const entry of requiredConfiguration) {
                lines.push(formatConfigurationEntry(entry));
            }
        }
        if (optionalConfiguration.length > 0) {
            lines.push('');
            lines.push('Optional configuration:');
            for (const entry of optionalConfiguration) {
                lines.push(formatConfigurationEntry(entry));
            }
        }
        if (
            Array.isArray(capability.configuration.setup_steps) &&
            capability.configuration.setup_steps.length > 0
        ) {
            lines.push('');
            lines.push('Setup steps:');
            for (const step of capability.configuration.setup_steps) {
                lines.push(`- ${step}`);
            }
        }
        if (Array.isArray(capability.configuration.notes) && capability.configuration.notes.length > 0) {
            lines.push('');
            lines.push('Configuration notes:');
            for (const note of capability.configuration.notes) {
                lines.push(`- ${note}`);
            }
        }
        if (hasRuntimeContextConfiguration(capability)) {
            lines.push('');
            lines.push(
                'Values sourced from `runtime_context.*` should be resolved by the runtime or host context broker when available.'
            );
        }
    }

    lines.push('');
    lines.push('## Preflight');
    lines.push('');
    lines.push(`1. Check router availability with \`GET ${metadata.router.health_url}\`.`);
    lines.push(`2. Run preflight with \`POST ${metadata.router.preflight_url}\`.`);
    lines.push('3. If preflight returns `PREPROCESSING_REQUIRED`, perform the listed preprocessing steps and retry preflight.');
    lines.push('4. If preflight returns `assist_then_delegate` or `delegate_now`, call invoke.');
    lines.push('');
    lines.push('### Preflight Request');
    lines.push('');
    lines.push('```json');
    lines.push(
        JSON.stringify(
            {
                method: 'POST',
                url: metadata.router.preflight_url,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: buildPreflightRequestBody(capability),
            },
            null,
            2
        )
    );
    lines.push('```');

    lines.push('');
    lines.push('## Invoke');
    lines.push('');
    lines.push(`Use \`POST ${metadata.router.invoke_url}\` after preflight succeeds.`);
    lines.push('');
    lines.push('### Invoke Request');
    lines.push('');
    lines.push('```json');
    lines.push(
        JSON.stringify(
            {
                method: 'POST',
                url: metadata.router.invoke_url,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: buildInvokeRequestBody(capability),
            },
            null,
            2
        )
    );
    lines.push('```');

    if (requiredPreprocessing.length > 0) {
        lines.push('');
        lines.push('## Preprocessing');
        lines.push('');
        lines.push('This capability declares required preprocessing before invoke:');
        for (const step of requiredPreprocessing) {
            lines.push(`- \`${step}\``);
        }
    }

    lines.push('');
    lines.push('## Constraints');
    lines.push('');
    lines.push('- Use the documented contract router routes only.');
    lines.push('- Do not call unrelated Local App endpoints directly.');
    lines.push('- Do not ask for `workspace_id`, `thread_id`, or `user_id` before first invoke if runtime context can provide them.');
    lines.push('- Never hardcode credentials or search source files, env files, or shell history for secrets.');
    lines.push('- If invoke fails with missing context or auth, then request the specific missing value.');

    if (examples.length > 0) {
        lines.push('');
        lines.push('## Example Intents');
        lines.push('');
        for (const example of examples.slice(0, 10)) {
            lines.push(`- ${String(example)}`);
        }
    }

    return `${lines.join('\n')}\n`;
}

function buildSkillMetadata(
    capability: ContractCapability,
    skillName: string,
    appId: string,
    appName: string,
    router: ContractSkillMetadata['router']
): ContractSkillMetadata {
    const description =
        typeof capability.description === 'string' && capability.description.trim()
            ? capability.description.trim()
            : `Invoke ${capability.name || capability.capability_id || 'local app capability'}.`;
    return {
        schema: 'agentskills.io/v1',
        name: skillName,
        description,
        app_id: appId || null,
        app_name: appName || null,
        capability_id: capability.capability_id || null,
        contract_version: LOCAL_APP_CONTRACT_VERSION,
        execution_mode: capability.execution_mode || 'delegate_only',
        domain: capability.domain || 'custom',
        intent_tags: Array.isArray(capability.intent_tags) ? capability.intent_tags : [],
        allowed_preprocessing: Array.isArray(capability.allowed_preprocessing)
            ? capability.allowed_preprocessing
            : [],
        allowed_side_effects: Array.isArray(capability.allowed_side_effects)
            ? capability.allowed_side_effects
            : [],
        network_policy: capability.network_policy || null,
        artifact_policy: capability.artifact_policy || null,
        approval_policy: capability.approval_policy || null,
        idempotency: capability.idempotency || null,
        error_codes: Array.isArray(capability.error_codes) ? capability.error_codes : [],
        configuration: capability.configuration || null,
        input_schema: isRecord(capability.input_schema) ? capability.input_schema : null,
        output_schema: isRecord(capability.output_schema) ? capability.output_schema : null,
        trigger: capability.trigger || null,
        delivery: capability.delivery || null,
        preflight: capability.preflight || null,
        permission: capability.permission || null,
        risk_level: capability.risk_level || null,
        tags: Array.isArray(capability.tags) ? capability.tags : [],
        examples: Array.isArray(capability.examples) ? capability.examples : [],
        router,
        generated_at: new Date().toISOString(),
    };
}

function readAppIndex(filePath: string): ContractSkillAppIndex | null {
    if (!fs.existsSync(filePath)) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!isRecord(parsed)) return null;
        const appId = typeof parsed.app_id === 'string' ? parsed.app_id.trim() : '';
        const appName = typeof parsed.app_name === 'string' ? parsed.app_name.trim() : '';
        const appDir = typeof parsed.app_dir === 'string' ? parsed.app_dir.trim() : '';
        const skills = Array.isArray(parsed.skills)
            ? parsed.skills
                  .filter((entry) => isRecord(entry))
                  .map((entry) => ({
                      name: typeof entry.name === 'string' ? entry.name : '',
                      path: typeof entry.path === 'string' ? entry.path : '',
                      app_id: typeof entry.app_id === 'string' ? entry.app_id : appId,
                      capability_id:
                          typeof entry.capability_id === 'string' ? entry.capability_id : '',
                      description:
                          typeof entry.description === 'string' ? entry.description : null,
                  }))
                  .filter((entry) => entry.name && entry.path && entry.capability_id)
            : [];
        if (!appId || !appName || !appDir) return null;
        return {
            app_id: appId,
            app_name: appName,
            app_dir: appDir,
            generated_at:
                typeof parsed.generated_at === 'string' && parsed.generated_at.trim()
                    ? parsed.generated_at
                    : new Date().toISOString(),
            count:
                Number.isFinite(Number(parsed.count)) && Number(parsed.count) >= 0
                    ? Number(parsed.count)
                    : skills.length,
            skills,
        };
    } catch {
        return null;
    }
}

export interface ContractSignInput {
    secret: string;
    eventId?: string;
    eventType: ContractEventType | string;
    taskId: string;
    attemptId?: string | number | null;
    timestamp?: string | null;
    payload?: unknown;
}

export function normalizeContractEvent(eventLike?: string | null): ContractEventType | null {
    if (!eventLike || typeof eventLike !== 'string') return null;
    const normalized = CONTRACT_EVENT_ALIASES[eventLike.trim().toLowerCase()];
    return normalized || null;
}

export function normalizeAttemptId(attemptLike?: string | number | null): string | undefined {
    if (attemptLike === null || attemptLike === undefined) return undefined;
    if (typeof attemptLike === 'number' && Number.isInteger(attemptLike) && attemptLike > 0) {
        return `${CONTRACT_ATTEMPT_PREFIX}${attemptLike}`;
    }
    if (typeof attemptLike !== 'string') return undefined;
    const trimmed = attemptLike.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith(CONTRACT_ATTEMPT_PREFIX)) return trimmed;
    if (/^\d+$/.test(trimmed)) return `${CONTRACT_ATTEMPT_PREFIX}${trimmed}`;
    return trimmed;
}

export function parseAttemptRunId(attemptLike?: string | number | null): number | null {
    const attemptId = normalizeAttemptId(attemptLike);
    if (!attemptId) return null;
    const matched = attemptId.match(/^run[-_:]?(\d+)$/i);
    if (!matched) return null;
    const value = Number(matched[1]);
    return Number.isInteger(value) && value > 0 ? value : null;
}

export function hashContractPayload(payload: unknown): string {
    const normalized =
        payload && typeof payload === 'object' ? payload : { value: payload ?? null };
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function createContractEventId(): string {
    return randomUUID();
}

export function buildContractSignatureMessage({
    eventId,
    eventType,
    taskId,
    attemptId,
    timestamp,
    payload,
}: Omit<ContractSignInput, 'secret'>): string {
    return [
        String(eventId || ''),
        String(normalizeContractEvent(String(eventType || '')) || eventType || ''),
        String(taskId || ''),
        String(normalizeAttemptId(attemptId) || ''),
        String(timestamp || ''),
        hashContractPayload(payload ?? {}),
    ].join('.');
}

export function signContractEvent(input: ContractSignInput): string {
    const signatureMessage = buildContractSignatureMessage(input);
    const digest = createHmac(CONTRACT_SIGNATURE_ALGORITHM, input.secret)
        .update(signatureMessage)
        .digest('hex');
    return `${CONTRACT_SIGNATURE_ALGORITHM}=${digest}`;
}

export function canonicalEventToLegacyAction(eventLike: string): string | null {
    const normalized = normalizeContractEvent(eventLike);
    if (!normalized) return null;
    return CONTRACT_LEGACY_ACTIONS[normalized] || null;
}

export function buildContractIdempotencyKey({
    taskId,
    eventType,
    eventId,
    attemptId,
    machineId,
    timestamp,
    payload,
}: {
    taskId: string;
    eventType: string;
    eventId?: string | null;
    attemptId?: string | number | null;
    machineId?: string | null;
    timestamp?: string | null;
    payload?: unknown;
}): string {
    const canonicalEvent = normalizeContractEvent(eventType) || eventType;
    if (eventId) {
        const eventToken = createHash('sha256').update(String(eventId)).digest('hex');
        return `${taskId}:${canonicalEvent}:event:${eventToken}`;
    }

    const hashInput = {
        task_id: taskId,
        event_type: canonicalEvent,
        attempt_id: normalizeAttemptId(attemptId),
        machine_id: machineId || null,
        timestamp: timestamp || null,
        payload_hash: hashContractPayload(payload ?? {}),
    };

    const token = createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');
    return `${taskId}:${canonicalEvent}:hash:${token}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringList(
    value: unknown,
    transform: (value: string) => string = (entry) => entry
): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const output: string[] = [];

    for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const normalized = transform(entry.trim());
        if (!normalized) continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(normalized);
    }

    return output;
}

function normalizeErrorCodes(value: unknown): string[] {
    return normalizeStringList(value, (entry) =>
        entry
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
    );
}

function normalizeExecutionMode(value: unknown): {
    value: 'delegate_only' | 'assist_then_delegate' | 'agent_only';
    migrated: boolean;
    invalid: boolean;
} {
    if (typeof value !== 'string' || !value.trim()) {
        return { value: 'delegate_only', migrated: true, invalid: false };
    }

    const normalized = value.trim().toLowerCase();
    if (
        normalized === 'delegate_only' ||
        normalized === 'assist_then_delegate' ||
        normalized === 'agent_only'
    ) {
        return {
            value: normalized,
            migrated: normalized !== value,
            invalid: false,
        };
    }

    return { value: 'delegate_only', migrated: true, invalid: true };
}

function normalizeRiskLevel(value: unknown): {
    value: 'low' | 'medium' | 'high' | null;
    migrated: boolean;
    invalid: boolean;
} {
    if (value === null || value === undefined || value === '') {
        return { value: null, migrated: false, invalid: false };
    }
    if (typeof value !== 'string') {
        return { value: null, migrated: true, invalid: true };
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
        return {
            value: normalized,
            migrated: normalized !== value,
            invalid: false,
        };
    }

    return { value: null, migrated: true, invalid: true };
}

function normalizeIdempotency(value: unknown): ContractCapability['idempotency'] {
    if (!isRecord(value)) return null;
    const keyFields = normalizeStringList(
        value.key_fields ?? value.keyFields,
        (entry) => entry
    );
    if (keyFields.length === 0) return null;
    return {
        key_fields: keyFields,
    };
}

function normalizeCapabilityConfigEntries(
    value: unknown
): Array<{ key: string; description?: string; source?: string; sensitive?: boolean }> {
    if (!Array.isArray(value)) return [];
    const output: Array<{
        key: string;
        description?: string;
        source?: string;
        sensitive?: boolean;
    }> = [];
    const seen = new Set<string>();

    for (const entry of value) {
        if (typeof entry === 'string' && entry.trim()) {
            const key = entry.trim();
            const dedupeKey = key.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            output.push({ key });
            continue;
        }
        if (!isRecord(entry)) continue;

        const keyCandidate = [
            entry.key,
            entry.name,
            entry.id,
            entry.field,
        ].find((candidate) => typeof candidate === 'string' && candidate.trim());
        if (typeof keyCandidate !== 'string' || !keyCandidate.trim()) continue;

        const key = keyCandidate.trim();
        const dedupeKey = key.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const normalizedEntry: {
            key: string;
            description?: string;
            source?: string;
            sensitive?: boolean;
        } = { key };
        if (typeof entry.description === 'string' && entry.description.trim()) {
            normalizedEntry.description = entry.description.trim();
        }
        if (typeof entry.source === 'string' && entry.source.trim()) {
            normalizedEntry.source = entry.source.trim();
        }
        if (entry.sensitive === true) {
            normalizedEntry.sensitive = true;
        }
        output.push(normalizedEntry);
    }

    return output;
}

function normalizeCapabilityConfiguration(capability: ContractCapabilityInput): {
    configuration: ContractCapability['configuration'];
    migrated: boolean;
} {
    let migrated = false;
    const source = isRecord(capability.configuration)
        ? capability.configuration
        : isRecord(capability.config_requirements)
        ? capability.config_requirements
        : isRecord(capability.configRequirements)
        ? capability.configRequirements
        : null;

    if (isRecord(capability.config_requirements) || isRecord(capability.configRequirements)) {
        migrated = true;
    }

    if (!source) {
        return {
            configuration: null,
            migrated,
        };
    }

    const requiredSource = source.required ?? source.required_fields ?? source.requiredFields;
    const optionalSource = source.optional ?? source.optional_fields ?? source.optionalFields;
    if (source.required_fields !== undefined || source.requiredFields !== undefined) {
        migrated = true;
    }
    if (source.optional_fields !== undefined || source.optionalFields !== undefined) {
        migrated = true;
    }

    const setupStepsSource = source.setup_steps ?? source.setupSteps ?? source.steps;
    if (source.setupSteps !== undefined || source.steps !== undefined) {
        migrated = true;
    }

    const configuration = {
        required: normalizeCapabilityConfigEntries(requiredSource),
        optional: normalizeCapabilityConfigEntries(optionalSource),
        setup_steps: normalizeStringList(setupStepsSource, (entry) => entry),
        notes: normalizeStringList(source.notes, (entry) => entry),
    };

    const hasValues =
        configuration.required.length > 0 ||
        configuration.optional.length > 0 ||
        configuration.setup_steps.length > 0 ||
        configuration.notes.length > 0;

    return {
        configuration: hasValues ? configuration : null,
        migrated,
    };
}

function normalizeCapabilityPreflight(capability: ContractCapabilityInput): {
    preflight: ContractCapability['preflight'];
    migrated: boolean;
} {
    const source = isRecord(capability.preflight)
        ? (capability.preflight as Record<string, unknown>)
        : null;
    if (!source) {
        return {
            preflight: null,
            migrated: false,
        };
    }

    const requiredPreprocessing = normalizeStringList(
        source.required_preprocessing ?? source.requiredPreprocessing,
        (entry) => entry.toLowerCase()
    );

    return {
        preflight:
            requiredPreprocessing.length > 0
                ? { required_preprocessing: requiredPreprocessing }
                : null,
        migrated: source.requiredPreprocessing !== undefined,
    };
}

function normalizeDeliveryMode(value: unknown): 'webhook' | 'api' {
    if (typeof value !== 'string') return 'webhook';
    const normalized = value.trim().toLowerCase();
    if (normalized === 'api') return 'api';
    return 'webhook';
}

function normalizeHeaderRecord(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {};
    const headers: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(value)) {
        const key = String(rawKey || '').trim();
        if (!key) continue;
        if (rawValue === null || rawValue === undefined) continue;
        const headerValue = String(rawValue).trim();
        if (!headerValue) continue;
        headers[key] = headerValue;
    }
    return headers;
}

function normalizeDelivery(capability: ContractCapabilityInput): {
    delivery: ContractCapability['delivery'];
    migrated: boolean;
} {
    let migrated = false;
    const source = isRecord(capability.delivery) ? capability.delivery : {};
    const mode = normalizeDeliveryMode(
        source.mode ?? capability.deliveryMode ?? (isRecord(source.api) ? 'api' : undefined)
    );
    if (
        capability.deliveryMode !== undefined ||
        capability.deliveryApi !== undefined
    ) {
        migrated = true;
    }

    const webhookSource = isRecord(source.webhook) ? source.webhook : {};
    const webhookRoute =
        typeof webhookSource.route === 'string' && webhookSource.route.trim()
            ? webhookSource.route.trim()
            : DEFAULT_CONTRACT_TRIGGER_ROUTE;

    if (mode !== 'api') {
        return {
            delivery: {
                mode: 'webhook',
                webhook: {
                    route: webhookRoute,
                },
                api: null,
            },
            migrated,
        };
    }

    const apiSource = isRecord(source.api)
        ? source.api
        : isRecord(capability.deliveryApi)
        ? capability.deliveryApi
        : {};
    if (!isRecord(source.api) && isRecord(capability.deliveryApi)) {
        migrated = true;
    }

    const methodRaw =
        typeof apiSource.method === 'string' ? apiSource.method.trim().toUpperCase() : '';
    const method =
        methodRaw === 'GET' ||
        methodRaw === 'POST' ||
        methodRaw === 'PUT' ||
        methodRaw === 'PATCH' ||
        methodRaw === 'DELETE'
            ? methodRaw
            : 'POST';
    const path = String(
        apiSource.path ?? apiSource.route ?? apiSource.url ?? ''
    ).trim();
    const payloadTemplate = isRecord(apiSource.payload_template)
        ? apiSource.payload_template
        : isRecord(apiSource.payloadTemplate)
        ? apiSource.payloadTemplate
        : undefined;
    if (!isRecord(apiSource.payload_template) && isRecord(apiSource.payloadTemplate)) {
        migrated = true;
    }

    return {
        delivery: {
            mode: 'api',
            webhook: {
                route: webhookRoute,
            },
            api: {
                method,
                path,
                headers: normalizeHeaderRecord(apiSource.headers),
                ...(payloadTemplate ? { payload_template: payloadTemplate } : {}),
            },
        },
        migrated,
    };
}

function normalizeCapabilityTrigger(
    value: unknown,
    defaultTriggerRoute: string
): {
    trigger: ContractCapability['trigger'];
    migrated: boolean;
    invalidEvent: boolean;
} {
    let migrated = false;
    let invalidEvent = false;
    const fallback = {
        event: 'task.trigger',
        route: defaultTriggerRoute,
    } as ContractCapability['trigger'];

    if (!isRecord(value)) {
        return { trigger: fallback, migrated: true, invalidEvent: false };
    }

    const eventValue = typeof value.event === 'string' ? value.event.trim() : '';
    const normalizedEvent = eventValue.toLowerCase();
    if (normalizedEvent && normalizedEvent !== 'task.trigger') {
        invalidEvent = true;
        migrated = true;
    } else if (!eventValue) {
        migrated = true;
    } else if (eventValue !== 'task.trigger') {
        migrated = true;
    }

    const routeValue = typeof value.route === 'string' ? value.route.trim() : '';
    if (!routeValue) {
        migrated = true;
    }

    const payloadTemplate = isRecord(value.payload_template)
        ? value.payload_template
        : isRecord(value.payloadTemplate)
        ? value.payloadTemplate
        : undefined;
    if (!isRecord(value.payload_template) && isRecord(value.payloadTemplate)) {
        migrated = true;
    }

    return {
        trigger: {
            event: 'task.trigger',
            route: routeValue || defaultTriggerRoute,
            ...(payloadTemplate ? { payload_template: payloadTemplate } : {}),
        },
        migrated,
        invalidEvent,
    };
}

function buildMigrationWarning(
    warning: Omit<CapabilityMigrationWarning, 'index'>,
    index: number
): CapabilityMigrationWarning {
    return {
        ...warning,
        index,
    };
}

export function compileCapabilities(
    capabilities: ContractCapabilityInput[] = [],
    options: CompileCapabilitiesOptions = {}
): CompiledCapabilitiesResult {
    const input = Array.isArray(capabilities) ? capabilities : [];
    const warnings: CapabilityMigrationWarning[] = [];
    const compiled: ContractCapability[] = [];
    let migratedCount = 0;
    let droppedCount = 0;
    const defaultTriggerRoute =
        typeof options.defaultTriggerRoute === 'string' && options.defaultTriggerRoute.trim()
            ? options.defaultTriggerRoute.trim()
            : DEFAULT_CONTRACT_TRIGGER_ROUTE;

    input.forEach((candidate, index) => {
        if (!isRecord(candidate)) {
            droppedCount += 1;
            warnings.push(
                buildMigrationWarning(
                    {
                        code: 'INVALID_CAPABILITY',
                        message: 'Capability entry must be an object.',
                    },
                    index
                )
            );
            return;
        }

        let migrated = false;
        const capabilityId = String(
            candidate.capability_id ?? candidate.capabilityId ?? candidate.id ?? ''
        ).trim();
        if (!capabilityId) {
            droppedCount += 1;
            warnings.push(
                buildMigrationWarning(
                    {
                        code: 'MISSING_CAPABILITY_ID',
                        message: 'Capability is missing capability_id (or capabilityId/id).',
                    },
                    index
                )
            );
            return;
        }
        if (capabilityId !== String(candidate.capability_id ?? '').trim()) {
            migrated = true;
        }

        const name = String(candidate.name ?? capabilityId).trim() || capabilityId;
        if (!candidate.name) migrated = true;

        const description = String(candidate.description ?? '').trim();
        const inputSchema = isRecord(candidate.input_schema)
            ? candidate.input_schema
            : isRecord(candidate.inputSchema)
            ? candidate.inputSchema
            : { type: 'object', additionalProperties: true };
        if (!isRecord(candidate.input_schema)) migrated = true;

        const outputSchema = isRecord(candidate.output_schema)
            ? candidate.output_schema
            : isRecord(candidate.outputSchema)
            ? candidate.outputSchema
            : undefined;
        if (!isRecord(candidate.output_schema) && isRecord(candidate.outputSchema)) {
            migrated = true;
        }

        const permission = String(candidate.permission ?? 'webhook.trigger').trim();
        if (!candidate.permission || permission !== candidate.permission) {
            migrated = true;
        }

        const triggerResult = normalizeCapabilityTrigger(candidate.trigger, defaultTriggerRoute);
        if (triggerResult.migrated) migrated = true;
        if (triggerResult.invalidEvent) {
            warnings.push(
                buildMigrationWarning(
                    {
                        code: 'INVALID_TRIGGER_EVENT',
                        capability_id: capabilityId,
                        message: `Capability "${capabilityId}" trigger.event must be "task.trigger".`,
                    },
                    index
                )
            );
        }

        const deliveryResult = normalizeDelivery(candidate);
        if (deliveryResult.migrated) migrated = true;

        const executionModeResult = normalizeExecutionMode(
            candidate.execution_mode ?? candidate.executionMode
        );
        if (executionModeResult.migrated) migrated = true;
        if (executionModeResult.invalid) {
            warnings.push(
                buildMigrationWarning(
                    {
                        code: 'INVALID_EXECUTION_MODE',
                        capability_id: capabilityId,
                        message: `Capability "${capabilityId}" had invalid execution_mode and was defaulted to delegate_only.`,
                    },
                    index
                )
            );
        }

        const riskLevelResult = normalizeRiskLevel(
            candidate.risk_level ?? candidate.riskLevel
        );
        if (riskLevelResult.migrated) migrated = true;
        if (riskLevelResult.invalid) {
            warnings.push(
                buildMigrationWarning(
                    {
                        code: 'INVALID_RISK_LEVEL',
                        capability_id: capabilityId,
                        message: `Capability "${capabilityId}" had invalid risk_level and was normalized to null.`,
                    },
                    index
                )
            );
        }

        const tags = normalizeStringList(candidate.tags, (entry) => entry);
        const examples = normalizeStringList(candidate.examples, (entry) => entry);
        const domain = String(candidate.domain ?? 'custom').trim().toLowerCase() || 'custom';
        if (!candidate.domain || domain !== candidate.domain) migrated = true;
        const intentTags = normalizeStringList(
            candidate.intent_tags ?? candidate.intentTags,
            (entry) => entry.toLowerCase()
        );
        if (!candidate.intent_tags && Array.isArray(candidate.intentTags)) migrated = true;
        const allowedPreprocessing = normalizeStringList(
            candidate.allowed_preprocessing ?? candidate.allowedPreprocessing,
            (entry) => entry.toLowerCase()
        );
        if (!candidate.allowed_preprocessing && Array.isArray(candidate.allowedPreprocessing)) {
            migrated = true;
        }
        const allowedSideEffects = normalizeStringList(
            candidate.allowed_side_effects ?? candidate.allowedSideEffects,
            (entry) => entry.toLowerCase()
        );
        if (!candidate.allowed_side_effects && Array.isArray(candidate.allowedSideEffects)) {
            migrated = true;
        }
        const errorCodes = normalizeErrorCodes(
            candidate.error_codes ?? candidate.errorCodes
        );
        if (!candidate.error_codes && Array.isArray(candidate.errorCodes)) migrated = true;
        const configurationResult = normalizeCapabilityConfiguration(candidate);
        if (configurationResult.migrated) migrated = true;
        const preflightResult = normalizeCapabilityPreflight(candidate);
        if (preflightResult.migrated) migrated = true;

        const networkPolicy: ContractCapability['network_policy'] = isRecord(
            candidate.network_policy
        )
            ? candidate.network_policy
            : isRecord(candidate.networkPolicy)
            ? candidate.networkPolicy
            : null;
        if (!isRecord(candidate.network_policy) && isRecord(candidate.networkPolicy)) {
            migrated = true;
        }

        const artifactPolicy: ContractCapability['artifact_policy'] = isRecord(
            candidate.artifact_policy
        )
            ? candidate.artifact_policy
            : isRecord(candidate.artifactPolicy)
            ? candidate.artifactPolicy
            : null;
        if (!isRecord(candidate.artifact_policy) && isRecord(candidate.artifactPolicy)) {
            migrated = true;
        }

        const approvalPolicy: ContractCapability['approval_policy'] = isRecord(
            candidate.approval_policy
        )
            ? candidate.approval_policy
            : isRecord(candidate.approvalPolicy)
            ? candidate.approvalPolicy
            : null;
        if (!isRecord(candidate.approval_policy) && isRecord(candidate.approvalPolicy)) {
            migrated = true;
        }

        const idempotency = normalizeIdempotency(
            candidate.idempotency ?? candidate.idempotencyPolicy
        );
        if (!isRecord(candidate.idempotency) && isRecord(candidate.idempotencyPolicy)) {
            migrated = true;
        }

        const enabled =
            candidate.enabled === undefined || candidate.enabled === null
                ? true
                : Boolean(candidate.enabled);

        compiled.push({
            capability_id: capabilityId,
            name,
            description,
            input_schema: inputSchema,
            ...(outputSchema ? { output_schema: outputSchema } : {}),
            permission,
            trigger: triggerResult.trigger,
            preflight: preflightResult.preflight,
            delivery: deliveryResult.delivery,
            domain,
            intent_tags: intentTags,
            execution_mode: executionModeResult.value,
            allowed_preprocessing: allowedPreprocessing,
            allowed_side_effects: allowedSideEffects,
            network_policy: networkPolicy,
            artifact_policy: artifactPolicy,
            approval_policy: approvalPolicy,
            idempotency,
            error_codes: errorCodes,
            configuration: configurationResult.configuration,
            tags,
            examples,
            risk_level: riskLevelResult.value,
            enabled,
        });

        if (migrated) migratedCount += 1;
    });

    if (options.strict && warnings.length > 0) {
        const summary = warnings
            .map((entry) => `[${entry.code}] #${entry.index}: ${entry.message}`)
            .join('\n');
        throw new Error(`compileCapabilities strict mode failed:\n${summary}`);
    }

    return {
        contract_version: LOCAL_APP_CONTRACT_VERSION,
        capabilities: compiled,
        warnings,
        input_count: input.length,
        output_count: compiled.length,
        migrated_count: migratedCount,
        dropped_count: droppedCount,
    };
}

function isMissingArgValue(value: unknown, fieldName: string): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return true;
        if (/^<[^>]+>$/.test(trimmed)) return true;
        if (trimmed === `<${fieldName}>`) return true;
    }
    return false;
}

function extractCapabilityId(body: ContractInvokeRequestBody): string {
    const payloadRaw = isRecord(body.payload?.raw_data) ? body.payload?.raw_data : {};
    const candidates = [
        body.capability_id,
        body.capabilityId,
        body.capability,
        typeof payloadRaw?.capability_id === 'string' ? payloadRaw.capability_id : undefined,
        typeof payloadRaw?.capability === 'string' ? payloadRaw.capability : undefined,
    ];
    for (const candidate of candidates) {
        const normalized = String(candidate || '').trim();
        if (normalized) return normalized;
    }
    return '';
}

function extractArgs(body: ContractInvokeRequestBody): Record<string, unknown> {
    if (isRecord(body.args)) return { ...body.args };
    const payloadRaw = isRecord(body.payload?.raw_data) ? body.payload?.raw_data : {};
    if (isRecord(payloadRaw?.args)) return { ...payloadRaw.args };
    return {};
}

function extractContext(body: ContractInvokeRequestBody): Record<string, unknown> {
    if (isRecord(body.context)) return { ...body.context };
    const payloadRaw = isRecord(body.payload?.raw_data) ? body.payload?.raw_data : {};
    if (isRecord(payloadRaw?.context)) return { ...payloadRaw.context };
    return {};
}

function extractContract(body: ContractInvokeRequestBody): Record<string, unknown> | null {
    if (isRecord(body.contract)) return { ...body.contract };
    return null;
}

function extractAgentic(body: ContractPreflightRequestBody): Record<string, unknown> {
    if (isRecord(body.agentic)) return { ...body.agentic };
    const payloadRaw = isRecord(body.payload?.raw_data) ? body.payload?.raw_data : {};
    if (isRecord(payloadRaw?._agentic)) return { ...payloadRaw._agentic };
    return {};
}

function resolveMissingRequiredArgsFromCapability(
    capability: ContractCapability,
    args: Record<string, unknown>
): string[] {
    const inputSchema = isRecord(capability.input_schema) ? capability.input_schema : {};
    const required = Array.isArray(inputSchema.required)
        ? inputSchema.required.filter(
              (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
          )
        : [];
    if (required.length === 0) return [];

    return required.filter((field) => {
        if (!Object.prototype.hasOwnProperty.call(args, field)) return true;
        return isMissingArgValue(args[field], field);
    });
}

function resolveRequiredPreprocessing(capability: ContractCapability): string[] {
    const source = isRecord(capability.preflight)
        ? (capability.preflight as Record<string, unknown>)
        : {};
    return normalizeStringList(
        source.required_preprocessing,
        (entry) => entry.toLowerCase()
    );
}

function resolveProvidedPreprocessing(body: ContractPreflightRequestBody): string[] {
    const agentic = extractAgentic(body);
    return normalizeStringList(agentic.preprocessing, (entry) => entry.toLowerCase());
}

function buildPreflightChecks({
    missingRequiredArgs,
    executionMode,
    missingPreprocessing,
}: {
    missingRequiredArgs: string[];
    executionMode: ContractCapability['execution_mode'];
    missingPreprocessing: string[];
}) {
    return [
        {
            code: 'INPUT_VALID',
            status: missingRequiredArgs.length > 0 ? 'fail' : 'pass',
            message:
                missingRequiredArgs.length > 0
                    ? `Missing required argument(s): ${missingRequiredArgs.join(', ')}`
                    : 'Input schema validation passed.',
        },
        {
            code: 'EXECUTION_MODE',
            status: executionMode === 'agent_only' ? 'fail' : 'pass',
            message:
                executionMode === 'agent_only'
                    ? 'Capability execution_mode=agent_only cannot be delegated through the SDK router.'
                    : `Capability execution_mode=${executionMode || 'delegate_only'}.`,
        },
        {
            code: 'PREPROCESSING_READY',
            status: missingPreprocessing.length > 0 ? 'fail' : 'pass',
            message:
                missingPreprocessing.length > 0
                    ? `Missing required preprocessing step(s): ${missingPreprocessing.join(', ')}`
                    : 'Preprocessing requirements satisfied.',
        },
    ] as ContractPreflightResponsePayload['checks'];
}

function sendJsonResponse<T>(
    res: {
        status?: (statusCode: number) => { json: (payload: T) => unknown } | unknown;
        json?: (payload: T) => unknown;
    },
    result: { status: number; payload: T },
    missingMessage: string
): void {
    if (typeof res?.status === 'function') {
        const statusResult = res.status(result.status);
        if (isRecord(statusResult) && typeof statusResult.json === 'function') {
            statusResult.json(result.payload);
            return;
        }
        if (typeof res.json === 'function') {
            res.json(result.payload);
            return;
        }
    }

    if (typeof res?.json === 'function') {
        res.json(result.payload);
        return;
    }

    throw new Error(missingMessage);
}

export class ContractModule {
    private readonly realtimexUrl: string;
    private readonly appName?: string;
    private readonly appId?: string;
    private readonly apiKey?: string;
    private cachedContract: LocalAppContractDefinition | null = null;
    private cachedCapabilities: ContractCapability[] | null = null;
    private cachedCapabilityCatalogHash: string | null = null;
    private localCompiledCapabilities: ContractCapability[] | null = null;
    private localCompileReport: CompiledCapabilitiesResult | null = null;

    constructor(realtimexUrl: string, appName?: string, appId?: string, apiKey?: string) {
        this.realtimexUrl = realtimexUrl.replace(/\/$/, '');
        this.appName = appName;
        this.appId = appId;
        this.apiKey = apiKey;
    }

    private async requestPermission(permission: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.realtimexUrl}/api/local-apps/request-permission`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    app_id: this.appId,
                    app_name: this.appName,
                    permission,
                }),
            });
            const data = await response.json();
            return data.granted === true;
        } catch {
            return false;
        }
    }

    private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.realtimexUrl}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string>),
        };

        if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
        if (this.appId) headers['x-app-id'] = this.appId;
        if (this.appName) headers['x-app-name'] = this.appName;

        const response = await fetch(url, {
            method: options.method || 'GET',
            headers,
            body: options.body,
        });
        const data = await response.json();

        if (response.status === 403) {
            const errorCode = data.error;
            const permission = data.permission;
            const message = data.message;

            if (errorCode === 'PERMISSION_REQUIRED' && permission) {
                const granted = await this.requestPermission(permission);
                if (granted) return this.request<T>(path, options);
                throw new PermissionDeniedError(permission, message);
            }

            if (errorCode === 'PERMISSION_DENIED') {
                throw new PermissionDeniedError(permission, message);
            }
        }

        if (!response.ok) {
            throw new Error(data.error || `Request failed: ${response.status}`);
        }

        return data;
    }

    async getLocalAppV1(forceRefresh = false): Promise<LocalAppContractDefinition> {
        if (!forceRefresh && this.cachedContract) return this.cachedContract;

        const data = await this.request<LocalAppContractResponse>('/contracts/local-app/v1');
        this.cachedContract = data.contract;
        if (Array.isArray(data.contract?.capabilities)) {
            this.cachedCapabilities = data.contract.capabilities;
            this.cachedCapabilityCatalogHash = data.contract.catalog_hash || null;
        }
        return data.contract;
    }

    async listCapabilities(forceRefresh = false): Promise<ContractCapability[]> {
        if (!forceRefresh && this.cachedCapabilities) return this.cachedCapabilities;

        const data = await this.request<LocalAppCapabilitiesResponse>(
            '/contracts/local-app/v1/capabilities'
        );
        this.cachedCapabilities = Array.isArray(data.capabilities)
            ? data.capabilities
            : [];
        this.cachedCapabilityCatalogHash = data.catalog_hash || null;
        return this.cachedCapabilities;
    }

    async searchCapabilities(query: string): Promise<ContractCapability[]> {
        const normalizedQuery = String(query || '').trim();
        if (!normalizedQuery) {
            throw new Error('searchCapabilities requires a non-empty query');
        }
        const encodedQuery = encodeURIComponent(normalizedQuery);
        const data = await this.request<LocalAppCapabilitySearchResponse>(
            `/contracts/local-app/v1/capabilities/search?q=${encodedQuery}`
        );
        return Array.isArray(data.capabilities) ? data.capabilities : [];
    }

    async describeCapability(capabilityId: string): Promise<ContractCapability> {
        const normalizedCapabilityId = String(capabilityId || '').trim();
        if (!normalizedCapabilityId) {
            throw new Error('describeCapability requires a non-empty capability id');
        }
        const encodedCapabilityId = encodeURIComponent(normalizedCapabilityId);
        const data = await this.request<LocalAppCapabilityDetailResponse>(
            `/contracts/local-app/v1/capabilities/${encodedCapabilityId}`
        );
        return data.capability;
    }

    // Alias for agentic contract flow naming.
    async search(query: string): Promise<ContractCapability[]> {
        return this.searchCapabilities(query);
    }

    // Alias for agentic contract flow naming.
    async describe(capabilityId: string): Promise<ContractCapability> {
        return this.describeCapability(capabilityId);
    }

    compileCapabilities(
        capabilities: ContractCapabilityInput[] = [],
        options: CompileCapabilitiesOptions = {}
    ): CompiledCapabilitiesResult {
        return compileCapabilities(capabilities, options);
    }

    setLocalCapabilityManifest(
        capabilities: ContractCapabilityInput[] = [],
        options: CompileCapabilitiesOptions = {}
    ): CompiledCapabilitiesResult {
        const report = compileCapabilities(capabilities, options);
        this.localCompileReport = report;
        this.localCompiledCapabilities = report.capabilities;
        return report;
    }

    getCompiledCapabilities(): ContractCapability[] {
        if (!Array.isArray(this.localCompiledCapabilities)) return [];
        return this.localCompiledCapabilities.slice();
    }

    getCapabilityCompileReport(): CompiledCapabilitiesResult | null {
        return this.localCompileReport;
    }

    async syncLocalCapabilities({
        capabilities,
        strict = false,
        contractVersion = LOCAL_APP_CONTRACT_VERSION,
    }: {
        capabilities?: ContractCapabilityInput[];
        strict?: boolean;
        contractVersion?: string;
    } = {}): Promise<ContractCapabilitySyncResponse> {
        const report = Array.isArray(capabilities)
            ? this.setLocalCapabilityManifest(capabilities, { strict })
            : this.localCompileReport;

        if (!report || !Array.isArray(report.capabilities)) {
            throw new Error(
                'No compiled capabilities available to sync. Provide capabilities or call setLocalCapabilityManifest first.'
            );
        }

        return this.request<ContractCapabilitySyncResponse>(
            '/sdk/local-apps/contract-capabilities',
            {
                method: 'POST',
                body: JSON.stringify({
                    contract_version: contractVersion || LOCAL_APP_CONTRACT_VERSION,
                    capabilities: report.capabilities,
                    migration_report: {
                        input_count: report.input_count,
                        output_count: report.output_count,
                        migrated_count: report.migrated_count,
                        dropped_count: report.dropped_count,
                        warning_count: report.warnings.length,
                    },
                }),
            }
        );
    }

    buildSkillArtifacts(
        options: ContractBuildSkillArtifactsOptions = {}
    ): ContractBuildSkillArtifactsResult {
        const appId = String(this.appId || '').trim();
        if (!appId) {
            throw new Error('buildSkillArtifacts requires appId on the ContractModule instance');
        }

        const appName = String(this.appName || appId).trim() || appId;
        const report = Array.isArray(options.capabilities)
            ? this.setLocalCapabilityManifest(options.capabilities, {
                  strict: options.strict === true,
              })
            : this.localCompileReport;

        if (!report || !Array.isArray(report.capabilities)) {
            throw new Error(
                'No compiled capabilities available to publish. Provide capabilities or call setLocalCapabilityManifest first.'
            );
        }

        const env = options.env || process.env;
        const rootDir = path.resolve(
            options.rootDir || getLocalAppAgentSkillsRootDir(env)
        );
        const appDir = toAppDirectoryName(appId);
        const appDirPath = path.join(rootDir, appDir);
        const baseUrl =
            String(
                options.baseUrl ||
                    env.RTX_LOCAL_APP_BASE_URL ||
                    env.LOCAL_APP_BASE_URL ||
                    ''
            ).trim() || DEFAULT_SKILL_BASE_URL;
        const preflightPath =
            String(options.preflightPath || DEFAULT_SKILL_PREFLIGHT_PATH).trim() ||
            DEFAULT_SKILL_PREFLIGHT_PATH;
        const healthPath =
            String(options.healthPath || DEFAULT_SKILL_HEALTH_PATH).trim() ||
            DEFAULT_SKILL_HEALTH_PATH;

        const capabilities = report.capabilities.filter(
            (capability) => capability.enabled !== false
        );

        const artifacts: ContractSkillArtifact[] = capabilities.map((capability) => {
            const invokePathCandidate =
                options.invokePath ||
                (capability.delivery?.mode === 'api' &&
                typeof capability.delivery.api?.path === 'string' &&
                capability.delivery.api.path.trim()
                    ? capability.delivery.api.path.trim()
                    : '');
            const invokePath = invokePathCandidate || DEFAULT_SKILL_INVOKE_PATH;
            const router = {
                base_url: baseUrl,
                preflight_path: preflightPath,
                invoke_path: invokePath,
                health_path: healthPath,
                preflight_url: joinUrl(baseUrl, preflightPath),
                invoke_url: joinUrl(baseUrl, invokePath),
                health_url: joinUrl(baseUrl, healthPath),
            };
            const skillName = buildSkillName({
                appId,
                appName,
                capabilityId: capability.capability_id,
            });
            const skillDir = path.join(appDirPath, skillName);
            const metadata = buildSkillMetadata(capability, skillName, appId, appName, router);
            return {
                name: skillName,
                app_id: appId,
                app_name: appName,
                capability_id: capability.capability_id,
                app_dir: appDir,
                skill_dir: skillDir,
                markdown_path: path.join(skillDir, SKILL_FILE),
                metadata_path: path.join(skillDir, SKILL_METADATA_FILE),
                markdown: buildSkillMarkdown(capability, metadata),
                metadata,
            };
        });

        const generatedAt = new Date().toISOString();
        const appIndex: ContractSkillAppIndex = {
            app_id: appId,
            app_name: appName,
            app_dir: appDir,
            generated_at: generatedAt,
            count: artifacts.length,
            skills: artifacts.map((artifact) => ({
                name: artifact.name,
                path: path.posix.join(appDir, artifact.name, SKILL_FILE),
                app_id: artifact.app_id,
                capability_id: artifact.capability_id,
                description: artifact.metadata.description || null,
            })),
        };

        return {
            root_dir: rootDir,
            app_id: appId,
            app_name: appName,
            app_dir: appDir,
            artifacts,
            app_index: appIndex,
        };
    }

    publishSkills(
        options: ContractBuildSkillArtifactsOptions = {}
    ): ContractPublishSkillsResult {
        const buildResult = this.buildSkillArtifacts(options);
        const appDirPath = path.join(buildResult.root_dir, buildResult.app_dir);
        const cleanupStaleSkills = options.cleanupStaleSkills !== false;
        let filesWritten = 0;
        let removedDirs = 0;

        ensureDir(buildResult.root_dir);
        ensureDir(appDirPath);

        const desiredSkillDirs = new Set<string>();
        for (const artifact of buildResult.artifacts) {
            ensureDir(artifact.skill_dir);
            desiredSkillDirs.add(artifact.name);

            if (writeFileIfChanged(artifact.markdown_path, artifact.markdown)) {
                filesWritten += 1;
            }
            if (
                writeFileIfChanged(
                    artifact.metadata_path,
                    `${JSON.stringify(artifact.metadata, null, 2)}\n`
                )
            ) {
                filesWritten += 1;
            }
        }

        if (cleanupStaleSkills) {
            for (const existingDir of listDirectoryNames(appDirPath)) {
                if (desiredSkillDirs.has(existingDir)) continue;
                if (removeDirectory(path.join(appDirPath, existingDir))) {
                    removedDirs += 1;
                }
            }
        }

        const appIndexPath = path.join(appDirPath, INDEX_FILE);
        if (buildResult.artifacts.length > 0) {
            if (
                writeFileIfChanged(
                    appIndexPath,
                    `${JSON.stringify(buildResult.app_index, null, 2)}\n`
                )
            ) {
                filesWritten += 1;
            }
        } else {
            removeFile(appIndexPath);
        }

        const rootApps = listDirectoryNames(buildResult.root_dir)
            .map((appDirName) =>
                readAppIndex(path.join(buildResult.root_dir, appDirName, INDEX_FILE))
            )
            .filter((index): index is ContractSkillAppIndex => Boolean(index))
            .filter((index) => index.count > 0)
            .map((index) => ({
                app_id: index.app_id,
                app_name: index.app_name,
                app_dir: index.app_dir,
                count: index.count,
            }))
            .sort((left, right) => left.app_name.localeCompare(right.app_name));

        const rootIndex: ContractSkillRootIndex = {
            schema: 'agentskills.io/catalog-v1',
            generated_at: new Date().toISOString(),
            root_dir: buildResult.root_dir,
            apps: rootApps,
        };
        if (
            writeFileIfChanged(
                path.join(buildResult.root_dir, INDEX_FILE),
                `${JSON.stringify(rootIndex, null, 2)}\n`
            )
        ) {
            filesWritten += 1;
        }

        return {
            success: true,
            ...buildResult,
            files_written: filesWritten,
            removed_dirs: removedDirs,
            root_index: rootIndex,
        };
    }

    private resolveInvokeCapabilities(
        options: ContractPreflightHandlerOptions | ContractInvokeHandlerOptions
    ): ContractCapability[] {
        if (Array.isArray(options.capabilities)) {
            return compileCapabilities(options.capabilities).capabilities;
        }
        if (Array.isArray(this.localCompiledCapabilities)) {
            return this.localCompiledCapabilities;
        }
        return [];
    }

    async handlePreflightRequest(
        body: ContractPreflightRequestBody,
        options: ContractPreflightHandlerOptions = {},
        _request?: unknown
    ): Promise<{ status: number; payload: ContractPreflightResponsePayload }> {
        const safeBody = isRecord(body) ? (body as ContractPreflightRequestBody) : {};
        const capabilityId = extractCapabilityId(safeBody);
        if (!capabilityId) {
            return {
                status: 400,
                payload: {
                    success: false,
                    capability_id: '',
                    decision: 'blocked',
                    next_action: 'provide_capability_id',
                    checks: [],
                    blocking_codes: ['INPUT_INVALID'],
                    code: 'INPUT_INVALID',
                    error: 'Missing required field: capability_id',
                },
            };
        }

        const resolvedCapabilities = this.resolveInvokeCapabilities(options);
        let capability = resolvedCapabilities.find(
            (entry) => entry.capability_id === capabilityId
        );
        if (!capability && resolvedCapabilities.length > 0) {
            return {
                status: 404,
                payload: {
                    success: false,
                    capability_id: capabilityId,
                    decision: 'blocked',
                    next_action: 'select_valid_capability',
                    checks: [],
                    blocking_codes: ['CAPABILITY_NOT_FOUND'],
                    code: 'CAPABILITY_NOT_FOUND',
                    error: `Capability not found in manifest: ${capabilityId}`,
                },
            };
        }

        if (!capability) {
            capability = {
                capability_id: capabilityId,
                name: capabilityId,
                input_schema: { type: 'object', additionalProperties: true },
                enabled: true,
            };
        }

        if (capability.enabled === false) {
            return {
                status: 403,
                payload: {
                    success: false,
                    capability_id: capabilityId,
                    decision: 'blocked',
                    next_action: 'select_valid_capability',
                    checks: [],
                    blocking_codes: ['CAPABILITY_DISABLED'],
                    code: 'CAPABILITY_DISABLED',
                    error: `Capability is disabled: ${capabilityId}`,
                },
            };
        }

        const args = extractArgs(safeBody);
        const missingRequiredArgs = resolveMissingRequiredArgsFromCapability(
            capability,
            args
        );
        const executionMode = capability.execution_mode || 'delegate_only';
        const requiredPreprocessing = resolveRequiredPreprocessing(capability);
        const providedPreprocessing = resolveProvidedPreprocessing(safeBody);
        const missingPreprocessing = requiredPreprocessing.filter(
            (entry) => !providedPreprocessing.includes(entry)
        );
        const checks = buildPreflightChecks({
            missingRequiredArgs,
            executionMode,
            missingPreprocessing,
        });

        if (missingRequiredArgs.length > 0) {
            return {
                status: 400,
                payload: {
                    success: false,
                    capability_id: capabilityId,
                    decision: 'blocked',
                    next_action: 'collect_required_args',
                    execution_mode: executionMode,
                    checks,
                    required_preprocessing: requiredPreprocessing,
                    blocking_codes: ['INPUT_INVALID'],
                    code: 'INPUT_INVALID',
                    error: `Missing required argument(s): ${missingRequiredArgs.join(', ')}`,
                    missing_required_args: missingRequiredArgs,
                },
            };
        }

        if (executionMode === 'agent_only') {
            return {
                status: 409,
                payload: {
                    success: false,
                    capability_id: capabilityId,
                    decision: 'blocked',
                    next_action: 'agent_execute_without_delegate',
                    execution_mode: executionMode,
                    checks,
                    required_preprocessing: requiredPreprocessing,
                    blocking_codes: ['EXECUTION_MODE_AGENT_ONLY'],
                    code: 'EXECUTION_MODE_AGENT_ONLY',
                    error:
                        'Capability execution_mode=agent_only cannot be delegated through the SDK router.',
                },
            };
        }

        if (missingPreprocessing.length > 0) {
            return {
                status: 409,
                payload: {
                    success: false,
                    capability_id: capabilityId,
                    decision: 'blocked',
                    next_action: 'perform_preprocessing_then_invoke',
                    execution_mode: executionMode,
                    checks,
                    required_preprocessing: missingPreprocessing,
                    blocking_codes: ['PREPROCESSING_REQUIRED'],
                    code: 'PREPROCESSING_REQUIRED',
                    error: `Missing required preprocessing step(s): ${missingPreprocessing.join(', ')}`,
                },
            };
        }

        return {
            status: 200,
            payload: {
                success: true,
                capability_id: capabilityId,
                decision:
                    executionMode === 'assist_then_delegate'
                        ? 'assist_then_delegate'
                        : 'delegate_now',
                next_action: 'invoke',
                execution_mode: executionMode,
                checks,
                required_preprocessing: [],
            },
        };
    }

    async handleHealthRequest(
        options: ContractPreflightHandlerOptions = {},
        _request?: unknown
    ): Promise<{ status: number; payload: ContractHealthResponsePayload }> {
        const resolvedCapabilities = this.resolveInvokeCapabilities(options);
        return {
            status: 200,
            payload: {
                success: true,
                status: 'ok',
                contract_version: LOCAL_APP_CONTRACT_VERSION,
                app_id: this.appId || undefined,
                app_name: this.appName || undefined,
                capability_count: resolvedCapabilities.length,
            },
        };
    }

    async handleInvokeRequest(
        body: ContractInvokeRequestBody,
        options: ContractInvokeHandlerOptions,
        request?: unknown
    ): Promise<{ status: number; payload: ContractInvokeResponsePayload }> {
        const safeBody = isRecord(body) ? (body as ContractInvokeRequestBody) : {};
        const capabilityId = extractCapabilityId(safeBody);
        if (!capabilityId) {
            return {
                status: 400,
                payload: {
                    success: false,
                    capability_id: '',
                    code: 'INPUT_INVALID',
                    error: 'Missing required field: capability_id',
                },
            };
        }

        const handlers = isRecord(options.handlers) ? options.handlers : {};
        const handler = handlers[capabilityId];
        if (typeof handler !== 'function') {
            return {
                status: 404,
                payload: {
                    success: false,
                    capability_id: capabilityId,
                    code: 'CAPABILITY_NOT_SUPPORTED',
                    error: `No capability handler registered for ${capabilityId}`,
                },
            };
        }

        const resolvedCapabilities = this.resolveInvokeCapabilities(options);
        let capability = resolvedCapabilities.find(
            (entry) => entry.capability_id === capabilityId
        );
        if (!capability && resolvedCapabilities.length > 0) {
            return {
                status: 404,
                payload: {
                    success: false,
                    capability_id: capabilityId,
                    code: 'CAPABILITY_NOT_FOUND',
                    error: `Capability not found in manifest: ${capabilityId}`,
                },
            };
        }

        if (!capability) {
            capability = {
                capability_id: capabilityId,
                name: capabilityId,
                input_schema: { type: 'object', additionalProperties: true },
                enabled: true,
            };
        }

        if (capability.enabled === false) {
            return {
                status: 403,
                payload: {
                    success: false,
                    capability_id: capabilityId,
                    code: 'CAPABILITY_DISABLED',
                    error: `Capability is disabled: ${capabilityId}`,
                },
            };
        }

        const args = extractArgs(safeBody);
        const context = extractContext(safeBody);
        const contract = extractContract(safeBody);
        const missingRequiredArgs = resolveMissingRequiredArgsFromCapability(
            capability,
            args
        );
        if (missingRequiredArgs.length > 0) {
            return {
                status: 400,
                payload: {
                    success: false,
                    capability_id: capabilityId,
                    code: 'INPUT_INVALID',
                    error: `Missing required argument(s): ${missingRequiredArgs.join(', ')}`,
                    missing_required_args: missingRequiredArgs,
                },
            };
        }

        try {
            const handlerInput: ContractInvokeHandlerInput = {
                capability_id: capabilityId,
                args,
                context,
                contract,
                capability,
                requestBody: safeBody,
                request,
            };
            const handlerResult = await handler(handlerInput);
            const safeResult = isRecord(handlerResult)
                ? (handlerResult as Record<string, unknown>)
                : {};

            if (safeResult.success === false) {
                const status = Number(safeResult.status);
                return {
                    status: Number.isFinite(status) && status > 0 ? status : 400,
                    payload: {
                        success: false,
                        capability_id: capabilityId,
                        code:
                            typeof safeResult.code === 'string' && safeResult.code.trim()
                                ? safeResult.code.trim()
                                : 'EXECUTION_FAILED',
                        error:
                            typeof safeResult.error === 'string' && safeResult.error.trim()
                                ? safeResult.error.trim()
                                : 'Capability handler returned an error response.',
                        ...safeResult,
                    },
                };
            }

            const successPayload: ContractInvokeResponsePayload = {
                success: true,
                capability_id: capabilityId,
                ...safeResult,
            };

            if (!successPayload.task_uuid && successPayload.task_id) {
                successPayload.task_uuid = String(successPayload.task_id);
            }
            if (!successPayload.task_id && successPayload.task_uuid) {
                successPayload.task_id = String(successPayload.task_uuid);
            }

            return {
                status: 200,
                payload: successPayload,
            };
        } catch (error) {
            const statusCandidate = Number(
                (error as { status?: unknown; statusCode?: unknown })?.status ??
                    (error as { statusCode?: unknown })?.statusCode
            );
            const status =
                Number.isFinite(statusCandidate) && statusCandidate > 0
                    ? statusCandidate
                    : 500;
            const code =
                typeof (error as { code?: unknown })?.code === 'string' &&
                (error as { code?: string }).code?.trim()
                    ? String((error as { code?: string }).code).trim()
                    : 'EXECUTION_FAILED';
            const message =
                error instanceof Error && error.message
                    ? error.message
                    : 'Capability handler execution failed';
            return {
                status,
                payload: {
                    success: false,
                    capability_id: capabilityId,
                    code,
                    error: message,
                },
            };
        }
    }

    createPreflightHandler(options: ContractPreflightHandlerOptions = {}) {
        return async (
            req: { body?: ContractPreflightRequestBody },
            res: {
                status?: (statusCode: number) => { json: (payload: ContractPreflightResponsePayload) => unknown } | unknown;
                json?: (payload: ContractPreflightResponsePayload) => unknown;
            }
        ) => {
            const result = await this.handlePreflightRequest(
                isRecord(req?.body) ? (req.body as ContractPreflightRequestBody) : {},
                options,
                req
            );
            sendJsonResponse(
                res,
                result,
                'createPreflightHandler requires a response object with json()'
            );
        };
    }

    createInvokeHandler(options: ContractInvokeHandlerOptions) {
        if (!options || !isRecord(options.handlers)) {
            throw new Error('createInvokeHandler requires options.handlers');
        }

        return async (
            req: { body?: ContractInvokeRequestBody },
            res: {
                status?: (statusCode: number) => { json: (payload: ContractInvokeResponsePayload) => unknown } | unknown;
                json?: (payload: ContractInvokeResponsePayload) => unknown;
            }
        ) => {
            const result = await this.handleInvokeRequest(
                isRecord(req?.body) ? (req.body as ContractInvokeRequestBody) : {},
                options,
                req
            );
            sendJsonResponse(
                res,
                result,
                'createInvokeHandler requires a response object with json()'
            );
        };
    }

    createHealthHandler(options: ContractPreflightHandlerOptions = {}) {
        return async (
            req: unknown,
            res: {
                status?: (statusCode: number) => { json: (payload: ContractHealthResponsePayload) => unknown } | unknown;
                json?: (payload: ContractHealthResponsePayload) => unknown;
            }
        ) => {
            const result = await this.handleHealthRequest(options, req);
            sendJsonResponse(
                res,
                result,
                'createHealthHandler requires a response object with json()'
            );
        };
    }

    createContractRouter(options: ContractInvokeHandlerOptions): ContractRouterHandlers {
        if (!options || !isRecord(options.handlers)) {
            throw new Error('createContractRouter requires options.handlers');
        }

        return {
            preflight: this.createPreflightHandler(options),
            invoke: this.createInvokeHandler(options),
            health: this.createHealthHandler(options),
            handlePreflightRequest: (body, request) =>
                this.handlePreflightRequest(body, options, request),
            handleInvokeRequest: (body, request) =>
                this.handleInvokeRequest(body, options, request),
            handleHealthRequest: (request) => this.handleHealthRequest(options, request),
        };
    }

    async invoke(payload: ContractInvokePayload): Promise<TriggerAgentResponse> {
        const capabilityId = String(payload?.capability_id || '').trim();
        if (!capabilityId) {
            throw new Error('invoke requires payload.capability_id');
        }
        if (payload.auto_run && (!payload.agent_name || !payload.workspace_slug)) {
            throw new Error('auto_run requires agent_name and workspace_slug');
        }

        const args: Record<string, unknown> =
            payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)
                ? { ...payload.args }
                : {};
        if (!args.capability) {
            args.capability = capabilityId;
        }

        return this.request<TriggerAgentResponse>('/webhooks/realtimex', {
            method: 'POST',
            body: JSON.stringify({
                app_name: this.appName,
                app_id: this.appId,
                event: 'task.trigger',
                event_id: payload.event_id || createContractEventId(),
                attempt_id: normalizeAttemptId(payload.attempt_id),
                payload: {
                    raw_data: args,
                    auto_run: payload.auto_run ?? false,
                    agent_name: payload.agent_name,
                    workspace_slug: payload.workspace_slug,
                    thread_slug: payload.thread_slug,
                    prompt: payload.prompt ?? '',
                },
            }),
        });
    }

    getCachedCatalogHash(): string | null {
        return this.cachedCapabilityCatalogHash;
    }

    clearCache(): void {
        this.cachedContract = null;
        this.cachedCapabilities = null;
        this.cachedCapabilityCatalogHash = null;
        this.localCompiledCapabilities = null;
        this.localCompileReport = null;
    }
}
