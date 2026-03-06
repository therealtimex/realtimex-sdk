import { createHash, createHmac, randomUUID } from 'crypto';
import { PermissionDeniedError } from './api';
import {
    ContractEventType,
    ContractCapability,
    ContractInvokePayload,
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
const MAX_PERMISSION_REQUEST_RETRIES = 1;

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
    return createHash('sha256').update(stableJsonStringify(normalized)).digest('hex');
}

function stableJsonStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
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

    const token = createHash('sha256').update(stableJsonStringify(hashInput)).digest('hex');
    return `${taskId}:${canonicalEvent}:hash:${token}`;
}

export class ContractModule {
    private readonly realtimexUrl: string;
    private readonly appName?: string;
    private readonly appId?: string;
    private readonly apiKey?: string;
    private cachedContract: LocalAppContractDefinition | null = null;
    private cachedCapabilities: ContractCapability[] | null = null;
    private cachedCapabilityCatalogHash: string | null = null;

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

    private async request<T>(
        path: string,
        options: RequestInit = {},
        permissionRetryCount = 0
    ): Promise<T> {
        const url = `${this.realtimexUrl}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string>),
        };

        if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
        if (this.appId) headers['x-app-id'] = this.appId;

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
                if (permissionRetryCount >= MAX_PERMISSION_REQUEST_RETRIES) {
                    throw new PermissionDeniedError(permission, message, 'PERMISSION_REQUIRED');
                }
                const granted = await this.requestPermission(permission);
                if (granted) return this.request<T>(path, options, permissionRetryCount + 1);
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
        if (!args.capability_id) {
            args.capability_id = capabilityId;
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
    }
}
