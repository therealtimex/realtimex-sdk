import type {
    ExecutionResult,
    IngestExecutionEventInput,
    RuntimeExecutionEvent,
} from '../core/types/runtime';
import { ACPEventMapper } from './ACPEventMapper';
import { ACPPermissionBridge } from './ACPPermissionBridge';
import { ACPTelemetry } from './ACPTelemetry';
import type {
    ACPAdapterContext,
    ACPContractAdapterOptions,
    ACPExecutionReference,
    ACPSessionUpdateParams,
    ACPToolInvocation,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function resolveTaskId(payload: Record<string, unknown>): string | undefined {
    return getString(payload.task_id) || getString(payload.task_uuid);
}

function resolveToolCallId(payload: Record<string, unknown>): string | undefined {
    const direct = getString(payload.tool_call_id);
    if (direct) return direct;

    if (isRecord(payload.payload)) {
        const nestedPayload = getString(payload.payload.tool_call_id);
        if (nestedPayload) return nestedPayload;
    }

    if (isRecord(payload.data)) {
        const nestedData = getString(payload.data.tool_call_id);
        if (nestedData) return nestedData;
    }

    return undefined;
}

function isTerminalStatus(status: 'pending' | 'in_progress' | 'completed' | 'failed'): boolean {
    return status === 'completed' || status === 'failed';
}

export class ACPContractAdapter {
    private readonly runtime: ACPContractAdapterOptions['runtime'];
    private readonly notifier: ACPContractAdapterOptions['notifier'];
    private readonly mapper: ACPEventMapper;
    private readonly permissionBridge: ACPPermissionBridge;
    private readonly telemetry: ACPTelemetry;
    private readonly taskReferences = new Map<string, ACPExecutionReference>();
    private readonly toolCallReferences = new Map<string, ACPExecutionReference>();
    private readonly runtimeUnsubscribe: () => void;

    constructor(options: ACPContractAdapterOptions) {
        this.runtime = options.runtime;
        this.notifier = options.notifier;
        this.mapper = new ACPEventMapper();
        this.permissionBridge = new ACPPermissionBridge({
            notifier: options.notifier,
            enabled: options.requestPermission === true,
            buildPermissionOptions: options.buildPermissionOptions,
        });
        this.telemetry = new ACPTelemetry(options.telemetry);
        this.runtimeUnsubscribe = this.runtime.onExecutionEvent((event) => {
            void this.handleRuntimeEvent(event);
        });
    }

    dispose(): void {
        this.runtimeUnsubscribe();
        this.taskReferences.clear();
        this.toolCallReferences.clear();
    }

    async executeTool(
        invocation: ACPToolInvocation,
        context: ACPAdapterContext
    ): Promise<ExecutionResult> {
        const reference = this.mapper.createReference(invocation, context);
        this.rememberReference(reference);

        await this.notify(this.mapper.buildPendingUpdate(invocation, reference));

        const permissionGranted = await this.permissionBridge.requestToolPermission(
            invocation,
            context
        );

        this.telemetry.emit({
            phase: 'permission',
            result: permissionGranted ? 'ok' : 'failed',
            sessionId: context.sessionId,
            toolCallId: invocation.toolCallId,
            toolName: invocation.toolName,
        });

        if (!permissionGranted) {
            const result: ExecutionResult = {
                status: 'failed',
                tool_call_id: invocation.toolCallId,
                error: {
                    code: 'permission_denied',
                    message: `Permission denied for ${invocation.toolName}`,
                    retryable: false,
                },
            };

            await this.notify(this.mapper.buildResultUpdate(result, reference));
            this.cleanupReference(reference, result);
            return result;
        }

        const result = await this.runtime.executeToolCall(
            {
                tool_call_id: invocation.toolCallId,
                tool_name: invocation.toolName,
                args: invocation.args,
            },
            {
                appId: context.appId,
                userId: context.userId,
                workspaceId: context.workspaceId,
                provider: context.provider,
                namespace: context.namespace,
            }
        );

        const normalizedResult: ExecutionResult = {
            ...result,
            tool_call_id: result.tool_call_id || invocation.toolCallId,
        };

        if (normalizedResult.task_id) {
            this.taskReferences.set(normalizedResult.task_id, reference);
        }

        await this.notify(this.mapper.buildResultUpdate(normalizedResult, reference));

        this.telemetry.emit({
            phase: 'execute',
            result: normalizedResult.status === 'failed' ? 'failed' : 'ok',
            sessionId: reference.sessionId,
            toolCallId: reference.toolCallId,
            toolName: invocation.toolName,
            taskId: normalizedResult.task_id,
            attemptId: normalizedResult.attempt_id,
            status:
                normalizedResult.status === 'queued'
                    ? 'in_progress'
                    : normalizedResult.status === 'completed'
                    ? 'completed'
                    : normalizedResult.status === 'failed'
                    ? 'failed'
                    : undefined,
            error: normalizedResult.error?.message,
        });

        this.cleanupReference(reference, normalizedResult);
        return normalizedResult;
    }

    ingestContractCallback(
        payload: Record<string, unknown>,
        context: Pick<ACPAdapterContext, 'sessionId'>
    ): RuntimeExecutionEvent | null {
        const initialTaskId = resolveTaskId(payload);
        const initialToolCallId = resolveToolCallId(payload);

        if (initialTaskId) {
            const existingByTask = this.taskReferences.get(initialTaskId);
            const existingByCall = initialToolCallId
                ? this.toolCallReferences.get(initialToolCallId)
                : undefined;

            const reference: ACPExecutionReference =
                existingByTask ||
                existingByCall || {
                    sessionId: context.sessionId,
                    toolCallId: initialToolCallId || initialTaskId,
                    appId: 'unknown',
                    userId: 'unknown',
                    title: initialToolCallId || initialTaskId,
                    kind: 'other',
                };

            this.taskReferences.set(initialTaskId, reference);
            this.toolCallReferences.set(reference.toolCallId, reference);
        }

        const event = this.runtime.ingestExecutionEvent(payload as IngestExecutionEventInput);

        this.telemetry.emit({
            phase: 'ingest',
            result: event ? 'ok' : 'skipped',
            sessionId: context.sessionId,
            toolCallId: event?.tool_call_id,
            taskId: event?.task_id,
            attemptId: event?.attempt_id,
            eventId: event?.event_id,
            eventType: event?.event_type,
        });

        return event;
    }

    private async handleRuntimeEvent(event: RuntimeExecutionEvent): Promise<void> {
        const reference = this.resolveReferenceForEvent(event);
        if (!reference) {
            this.telemetry.emit({
                phase: 'runtime_event',
                result: 'skipped',
                toolCallId: event.tool_call_id,
                taskId: event.task_id,
                attemptId: event.attempt_id,
                eventId: event.event_id,
                eventType: event.event_type,
            });
            return;
        }

        this.taskReferences.set(event.task_id, reference);

        const update = this.mapper.buildLifecycleUpdate(event, reference);
        if (!update) {
            this.telemetry.emit({
                phase: 'runtime_event',
                result: 'skipped',
                sessionId: reference.sessionId,
                toolCallId: reference.toolCallId,
                taskId: event.task_id,
                attemptId: event.attempt_id,
                eventId: event.event_id,
                eventType: event.event_type,
            });
            return;
        }

        await this.notify(update);

        this.telemetry.emit({
            phase: 'runtime_event',
            result: 'ok',
            sessionId: reference.sessionId,
            toolCallId: reference.toolCallId,
            taskId: event.task_id,
            attemptId: event.attempt_id,
            eventId: event.event_id,
            eventType: event.event_type,
            status: update.update.status,
        });

        if (isTerminalStatus(update.update.status)) {
            this.taskReferences.delete(event.task_id);
            this.toolCallReferences.delete(reference.toolCallId);
        }
    }

    private resolveReferenceForEvent(event: RuntimeExecutionEvent): ACPExecutionReference | undefined {
        const byTask = this.taskReferences.get(event.task_id);
        if (byTask) return byTask;

        const byToolCall = this.toolCallReferences.get(event.tool_call_id);
        if (byToolCall) return byToolCall;

        return undefined;
    }

    private rememberReference(reference: ACPExecutionReference): void {
        this.toolCallReferences.set(reference.toolCallId, reference);
    }

    private cleanupReference(reference: ACPExecutionReference, result: ExecutionResult): void {
        const status =
            result.status === 'queued'
                ? 'in_progress'
                : result.status === 'completed'
                ? 'completed'
                : result.status === 'failed'
                ? 'failed'
                : 'failed';

        if (!isTerminalStatus(status)) return;

        this.toolCallReferences.delete(reference.toolCallId);
        if (result.task_id) {
            this.taskReferences.delete(result.task_id);
        }
    }

    private async notify(update: ACPSessionUpdateParams): Promise<void> {
        try {
            await this.notifier.notify('session/update', update);
            this.telemetry.emit({
                phase: 'notify',
                result: 'ok',
                sessionId: update.sessionId,
                toolCallId: update.update.toolCallId,
                status: update.update.status,
                metadata: {
                    type: update.update.type,
                },
            });
        } catch (error) {
            const reference = this.toolCallReferences.get(update.update.toolCallId);
            this.telemetry.emit({
                phase: 'notify',
                result: 'failed',
                sessionId: update.sessionId,
                toolCallId: update.update.toolCallId,
                status: update.update.status,
                error: error instanceof Error ? error.message : 'Unknown notify error',
            });

            if (!reference) return;

            const failureUpdate = this.mapper.buildNotifyFailureUpdate(reference, error);
            try {
                await this.notifier.notify('session/update', failureUpdate);
            } catch {
                // Ignore recursive notify failures.
            }
        }
    }
}
