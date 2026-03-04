import { normalizeAttemptId, normalizeContractEvent } from '../../modules/contract';
import { ScopeGuard } from '../auth/ScopeGuard';
import { ContractCache } from '../contract/ContractCache';
import { ContractClient } from '../contract/ContractClient';
import {
    ContractError,
    ContractValidationError,
    RuntimeTransportError,
    ToolNotFoundError,
    ToolValidationError,
} from '../errors/ContractErrors';
import { ContractHttpClient } from '../transport/HttpClient';
import type { LocalAppContractV1, ProviderKind } from '../types/contract';
import type {
    ContractRuntimeInterface,
    ExecutionContext,
    ExecutionResult,
    GetToolsInput,
    IngestExecutionEventInput,
    LifecycleEventType,
    RuntimeExecutionEvent,
    ToolCall,
} from '../types/runtime';
import type { CanonicalToolDefinition } from '../types/tooling';
import { ToolProjector } from '../tooling/ToolProjector';
import { ExecutionStore } from './ExecutionStore';
import { LifecycleReporter } from './LifecycleReporter';
import { RetryPolicy, RetryPolicyOptions } from './RetryPolicy';

const LIFECYCLE_EVENTS = new Set<LifecycleEventType>([
    'task.claimed',
    'task.started',
    'task.progress',
    'task.completed',
    'task.failed',
    'task.canceled',
]);

const DEFAULT_PROVIDER: ProviderKind = 'gemini';

interface WebhookTriggerResponse {
    success?: boolean;
    task_uuid?: string;
    task_id?: string;
    attempt_id?: string;
    event_type?: string;
    event_id?: string;
    message?: string;
    error?: string;
    [key: string]: unknown;
}

export interface ContractRuntimeOptions {
    baseUrl: string;
    appId?: string;
    appName?: string;
    apiKey?: string;
    permissions?: string[];
    namespace?: string;
    fetchImpl?: typeof fetch;
    cacheTtlMs?: number;
    retry?: RetryPolicyOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function resolveToolCallId(input: IngestExecutionEventInput): string | undefined {
    if (typeof input.tool_call_id === 'string' && input.tool_call_id.trim().length > 0) {
        return input.tool_call_id;
    }

    const payload = isRecord(input.payload) ? input.payload : undefined;
    if (payload && typeof payload.tool_call_id === 'string' && payload.tool_call_id.trim().length > 0) {
        return payload.tool_call_id;
    }

    const data = isRecord(input.data) ? input.data : undefined;
    if (data && typeof data.tool_call_id === 'string' && data.tool_call_id.trim().length > 0) {
        return data.tool_call_id;
    }

    return undefined;
}

export class ContractRuntime implements ContractRuntimeInterface {
    private readonly appId?: string;
    private readonly appName?: string;
    private readonly defaultNamespace?: string;
    private readonly contractClient: ContractClient;
    private readonly toolProjector: ToolProjector;
    private readonly executionStore: ExecutionStore;
    private readonly lifecycleReporter: LifecycleReporter;
    private readonly scopeGuard: ScopeGuard;
    private readonly retryPolicy: RetryPolicy;
    private readonly httpClient: ContractHttpClient;

    constructor(options: ContractRuntimeOptions) {
        if (!options.baseUrl) {
            throw new ContractValidationError('ContractRuntime requires baseUrl');
        }

        this.appId = options.appId;
        this.appName = options.appName;
        this.defaultNamespace = options.namespace;
        this.httpClient = new ContractHttpClient({
            baseUrl: options.baseUrl,
            appId: options.appId,
            appName: options.appName,
            apiKey: options.apiKey,
            fetchImpl: options.fetchImpl,
        });
        this.contractClient = new ContractClient(this.httpClient, {
            cache: new ContractCache(options.cacheTtlMs ?? 30_000),
        });
        this.toolProjector = new ToolProjector();
        this.executionStore = new ExecutionStore();
        this.lifecycleReporter = new LifecycleReporter();
        this.scopeGuard = new ScopeGuard(options.permissions || []);
        this.retryPolicy = new RetryPolicy(options.retry);
    }

    async getContract(appId: string): Promise<LocalAppContractV1> {
        this.assertAppContext(appId);
        return this.contractClient.getLocalAppV1(false);
    }

    async getTools(input: GetToolsInput): Promise<CanonicalToolDefinition[]> {
        this.assertAppContext(input.appId);

        const contract = await this.contractClient.getLocalAppV1(false);
        const tools = this.toolProjector.project({
            contract,
            provider: input.provider,
            appId: input.appId,
            namespace: input.namespace || this.defaultNamespace || input.appId,
        });

        this.executionStore.registerTools(
            this.buildRegistryKey(input.appId, input.provider, input.namespace),
            tools
        );

        return tools;
    }

    async executeToolCall(call: ToolCall, context: ExecutionContext): Promise<ExecutionResult> {
        try {
            this.assertAppContext(context.appId);

            const provider = context.provider || DEFAULT_PROVIDER;
            const namespace = context.namespace || this.defaultNamespace || context.appId;
            const registryKey = this.buildRegistryKey(context.appId, provider, namespace);

            if (!this.executionStore.hasRegistry(registryKey)) {
                await this.getTools({
                    appId: context.appId,
                    provider,
                    namespace,
                });
            }

            const tool = this.executionStore.getTool(registryKey, call.tool_name);
            if (!tool) {
                throw new ToolNotFoundError(call.tool_name, {
                    registryKey,
                });
            }

            this.scopeGuard.assert(tool.permission);

            const validationErrors = this.validateToolArgs(tool, call.args);
            if (validationErrors.length > 0) {
                throw new ToolValidationError('Tool input validation failed', {
                    tool_name: call.tool_name,
                    errors: validationErrors,
                });
            }

            const eventId = context.idempotencyKey || call.tool_call_id;
            const requestBody = this.buildTriggerRequestBody(call, context, tool, eventId);

            const response = await this.retryPolicy.execute(() =>
                this.httpClient.post<WebhookTriggerResponse>(tool.trigger.route || '/webhooks/realtimex', requestBody)
            );

            if (response.success === false) {
                throw new RuntimeTransportError(response.error || 'Failed to trigger task', undefined, response);
            }

            const taskId = this.resolveTaskId(response);
            const attemptId = normalizeAttemptId(response.attempt_id);

            this.tryEmitLifecycleEvent({
                tool_call_id: call.tool_call_id,
                task_id: taskId,
                attempt_id: attemptId,
                event_type: response.event_type,
                event_id: response.event_id,
                timestamp: new Date().toISOString(),
                payload: toRecord(response),
            });

            if (taskId) {
                return {
                    status: 'queued',
                    tool_call_id: call.tool_call_id,
                    task_id: taskId,
                    attempt_id: attemptId,
                    output: {
                        message: response.message || 'Task accepted',
                    },
                };
            }

            return {
                status: 'completed',
                tool_call_id: call.tool_call_id,
                output: toRecord(response),
            };
        } catch (error) {
            return this.toFailedResult(call.tool_call_id, error);
        }
    }

    onExecutionEvent(handler: (event: RuntimeExecutionEvent) => void): () => void {
        return this.lifecycleReporter.onEvent(handler);
    }

    ingestExecutionEvent(input: IngestExecutionEventInput): RuntimeExecutionEvent | null {
        const eventTypeRaw =
            (typeof input.event_type === 'string' && input.event_type) ||
            (typeof input.event === 'string' && input.event) ||
            '';

        const normalized = normalizeContractEvent(eventTypeRaw);
        if (!normalized || !LIFECYCLE_EVENTS.has(normalized as LifecycleEventType)) {
            return null;
        }

        const taskId =
            (typeof input.task_id === 'string' && input.task_id) ||
            (typeof input.task_uuid === 'string' && input.task_uuid) ||
            '';

        if (!taskId) return null;

        const event: RuntimeExecutionEvent = {
            tool_call_id: resolveToolCallId(input) || taskId,
            task_id: taskId,
            attempt_id: normalizeAttemptId(input.attempt_id),
            event_type: normalized as LifecycleEventType,
            event_id:
                (typeof input.event_id === 'string' && input.event_id) ||
                `${taskId}:${normalized}:${Date.now()}`,
            timestamp:
                (typeof input.timestamp === 'string' && input.timestamp) ||
                new Date().toISOString(),
            payload: toRecord(input.payload || input.data),
        };

        this.lifecycleReporter.emit(event);
        return event;
    }

    clearCache(): void {
        this.contractClient.clearCache();
        this.executionStore.clear();
    }

    private assertAppContext(appId: string): void {
        if (!appId || appId.trim().length === 0) {
            throw new ContractValidationError('appId is required');
        }

        if (this.appId && this.appId !== appId) {
            throw new ContractValidationError('Runtime appId mismatch', {
                runtime_app_id: this.appId,
                requested_app_id: appId,
            });
        }
    }

    private buildRegistryKey(appId: string, provider: ProviderKind, namespace?: string): string {
        const resolvedNamespace = namespace || this.defaultNamespace || appId;
        return `${appId}:${provider}:${resolvedNamespace}`;
    }

    private resolveTaskId(response: WebhookTriggerResponse): string | undefined {
        if (typeof response.task_uuid === 'string' && response.task_uuid.trim().length > 0) {
            return response.task_uuid;
        }

        if (typeof response.task_id === 'string' && response.task_id.trim().length > 0) {
            return response.task_id;
        }

        return undefined;
    }

    private buildTriggerRequestBody(
        call: ToolCall,
        context: ExecutionContext,
        tool: CanonicalToolDefinition,
        eventId: string
    ): Record<string, unknown> {
        const payloadTemplate = isRecord(tool.trigger.payload_template)
            ? tool.trigger.payload_template
            : {};

        const templateRawData = isRecord(payloadTemplate.raw_data)
            ? payloadTemplate.raw_data
            : {};

        const payload: Record<string, unknown> = {
            ...payloadTemplate,
            raw_data: {
                ...templateRawData,
                capability_id: tool.capability_id,
                tool_name: call.tool_name,
                tool_call_id: call.tool_call_id,
                args: call.args,
                context: {
                    app_id: context.appId,
                    user_id: context.userId,
                    workspace_id: context.workspaceId || null,
                    request_id: context.requestId || null,
                    metadata: context.metadata || null,
                },
            },
        };

        if (typeof payload.auto_run !== 'boolean') {
            payload.auto_run = false;
        }

        return {
            app_name: this.appName,
            // In API-key dev mode, app_id should be omitted unless explicitly configured
            // on the runtime. Passing an unknown app_id causes webhook trigger rejection.
            app_id: this.appId || undefined,
            event: tool.trigger.event,
            event_id: eventId,
            payload,
        };
    }

    private validateToolArgs(tool: CanonicalToolDefinition, args: Record<string, unknown>): string[] {
        const errors: string[] = [];

        if (!isRecord(args)) {
            errors.push('args must be an object');
            return errors;
        }

        const requiredFields = Array.isArray(tool.input_schema.required)
            ? tool.input_schema.required.filter((field): field is string => typeof field === 'string')
            : [];

        for (const field of requiredFields) {
            const value = args[field];
            if (
                value === undefined ||
                value === null ||
                (typeof value === 'string' && value.trim().length === 0)
            ) {
                errors.push(`Missing required field: ${field}`);
            }
        }

        const properties = isRecord(tool.input_schema.properties)
            ? tool.input_schema.properties
            : {};

        for (const [field, schemaValue] of Object.entries(properties)) {
            if (!(field in args)) continue;
            if (!isRecord(schemaValue)) continue;

            const typeValue = schemaValue.type;
            if (typeof typeValue === 'string') {
                if (!this.matchesType(args[field], typeValue)) {
                    errors.push(`Invalid type for ${field}: expected ${typeValue}`);
                }
            }

            if (Array.isArray(typeValue)) {
                const valid = typeValue.some(
                    (item): item is string =>
                        typeof item === 'string' && this.matchesType(args[field], item)
                );
                if (!valid) {
                    errors.push(
                        `Invalid type for ${field}: expected one of ${typeValue
                            .filter((item): item is string => typeof item === 'string')
                            .join(', ')}`
                    );
                }
            }
        }

        return errors;
    }

    private matchesType(value: unknown, expectedType: string): boolean {
        switch (expectedType) {
            case 'string':
                return typeof value === 'string';
            case 'number':
                return typeof value === 'number' && Number.isFinite(value);
            case 'integer':
                return typeof value === 'number' && Number.isInteger(value);
            case 'boolean':
                return typeof value === 'boolean';
            case 'object':
                return isRecord(value);
            case 'array':
                return Array.isArray(value);
            case 'null':
                return value === null;
            default:
                return true;
        }
    }

    private tryEmitLifecycleEvent(input: {
        tool_call_id: string;
        task_id?: string;
        attempt_id?: string;
        event_type?: string;
        event_id?: string;
        timestamp: string;
        payload?: Record<string, unknown>;
    }): void {
        if (!input.task_id || !input.event_type) return;

        const normalized = normalizeContractEvent(input.event_type);
        if (!normalized || !LIFECYCLE_EVENTS.has(normalized as LifecycleEventType)) {
            return;
        }

        this.lifecycleReporter.emit({
            tool_call_id: input.tool_call_id,
            task_id: input.task_id,
            attempt_id: normalizeAttemptId(input.attempt_id),
            event_type: normalized as LifecycleEventType,
            event_id: input.event_id || `${input.task_id}:${normalized}:${Date.now()}`,
            timestamp: input.timestamp,
            payload: input.payload,
        });
    }

    private toFailedResult(toolCallId: string, error: unknown): ExecutionResult {
        if (error instanceof ContractError) {
            const retryable =
                error instanceof RuntimeTransportError
                    ? error.statusCode === undefined || error.statusCode >= 500 || error.statusCode === 429
                    : false;

            return {
                status: 'failed',
                tool_call_id: toolCallId,
                error: {
                    code: error.code,
                    message: error.message,
                    retryable,
                },
            };
        }

        if (error instanceof Error) {
            return {
                status: 'failed',
                tool_call_id: toolCallId,
                error: {
                    code: 'runtime_error',
                    message: error.message,
                    retryable: true,
                },
            };
        }

        return {
            status: 'failed',
            tool_call_id: toolCallId,
            error: {
                code: 'runtime_error',
                message: 'Unknown runtime error',
                retryable: true,
            },
        };
    }
}
