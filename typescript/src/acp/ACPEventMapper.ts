import type { ExecutionResult, RuntimeExecutionEvent } from '../core/types/runtime';
import type {
    ACPAdapterContext,
    ACPExecutionReference,
    ACPSessionUpdateParams,
    ACPToolInvocation,
    ACPToolStatus,
} from './types';

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
}

function buildRealtimeXMeta(input: {
    reference: ACPExecutionReference;
    taskId?: string;
    attemptId?: string;
    eventId?: string;
    contractEvent?: string;
    cancelled?: boolean;
}): Record<string, unknown> {
    return {
        realtimex: {
            tool_call_id: input.reference.toolCallId,
            task_id: input.taskId,
            attempt_id: input.attemptId,
            event_id: input.eventId,
            contract_version: 'local-app-contract/v1',
            contract_event: input.contractEvent,
            cancelled: input.cancelled === true ? true : undefined,
            app_id: input.reference.appId,
            user_id: input.reference.userId,
            workspace_id: input.reference.workspaceId,
            provider: input.reference.provider,
            namespace: input.reference.namespace,
        },
    };
}

export class ACPEventMapper {
    createReference(invocation: ACPToolInvocation, context: ACPAdapterContext): ACPExecutionReference {
        return {
            sessionId: context.sessionId,
            toolCallId: invocation.toolCallId,
            appId: context.appId,
            userId: context.userId,
            workspaceId: context.workspaceId,
            provider: context.provider,
            namespace: context.namespace,
            title: invocation.title || invocation.toolName,
            kind: invocation.kind || 'execute',
        };
    }

    buildPendingUpdate(
        invocation: ACPToolInvocation,
        reference: ACPExecutionReference
    ): ACPSessionUpdateParams {
        return {
            sessionId: reference.sessionId,
            update: {
                type: 'tool_call',
                toolCallId: invocation.toolCallId,
                title: reference.title,
                kind: reference.kind,
                status: 'pending',
                rawInput: invocation.args,
                _meta: buildRealtimeXMeta({
                    reference,
                    contractEvent: 'task.trigger',
                }),
            },
        };
    }

    buildResultUpdate(
        result: ExecutionResult,
        reference: ACPExecutionReference
    ): ACPSessionUpdateParams {
        const status = this.mapExecutionResultStatus(result);
        const taskId = result.task_id;
        const attemptId = result.attempt_id;
        const contractEvent =
            status === 'completed'
                ? 'task.completed'
                : status === 'failed'
                ? 'task.failed'
                : 'task.started';

        const rawOutput: Record<string, unknown> =
            status === 'failed'
                ? {
                      error: result.error || {
                          code: 'runtime_error',
                          message: 'Unknown runtime error',
                          retryable: true,
                      },
                  }
                : {
                      ...(result.output || {}),
                      task_id: taskId,
                      attempt_id: attemptId,
                  };

        return {
            sessionId: reference.sessionId,
            update: {
                type: 'tool_call_update',
                toolCallId: reference.toolCallId,
                status,
                content: [
                    {
                        type: 'text',
                        text:
                            status === 'in_progress'
                                ? 'Task queued'
                                : status === 'completed'
                                ? 'Task completed'
                                : 'Task failed',
                    },
                ],
                rawOutput,
                _meta: buildRealtimeXMeta({
                    reference,
                    taskId,
                    attemptId,
                    contractEvent,
                }),
            },
        };
    }

    buildLifecycleUpdate(
        event: RuntimeExecutionEvent,
        reference: ACPExecutionReference
    ): ACPSessionUpdateParams | null {
        const status = this.mapContractEventStatus(event.event_type);
        if (!status) return null;

        const payload = event.payload || {};
        const progressText = this.resolveEventText(event.event_type, payload);
        const cancelled = event.event_type === 'task.canceled';

        return {
            sessionId: reference.sessionId,
            update: {
                type: 'tool_call_update',
                toolCallId: reference.toolCallId,
                status,
                content: progressText
                    ? [
                          {
                              type: 'text',
                              text: progressText,
                          },
                      ]
                    : undefined,
                rawOutput: payload,
                _meta: buildRealtimeXMeta({
                    reference,
                    taskId: event.task_id,
                    attemptId: event.attempt_id,
                    eventId: event.event_id,
                    contractEvent: event.event_type,
                    cancelled,
                }),
            },
        };
    }

    buildNotifyFailureUpdate(
        reference: ACPExecutionReference,
        error: unknown
    ): ACPSessionUpdateParams {
        return {
            sessionId: reference.sessionId,
            update: {
                type: 'tool_call_update',
                toolCallId: reference.toolCallId,
                status: 'failed',
                content: [
                    {
                        type: 'text',
                        text: `Adapter notify failed: ${getErrorMessage(error)}`,
                    },
                ],
                rawOutput: {
                    error: {
                        code: 'acp_notify_failed',
                        message: getErrorMessage(error),
                    },
                },
                _meta: buildRealtimeXMeta({
                    reference,
                    contractEvent: 'adapter.notify_failed',
                }),
            },
        };
    }

    mapContractEventStatus(eventType: string): ACPToolStatus | null {
        switch (eventType) {
            case 'task.claimed':
            case 'task.started':
            case 'task.progress':
                return 'in_progress';
            case 'task.completed':
                return 'completed';
            case 'task.failed':
            case 'task.canceled':
                return 'failed';
            default:
                return null;
        }
    }

    private mapExecutionResultStatus(result: ExecutionResult): ACPToolStatus {
        switch (result.status) {
            case 'completed':
                return 'completed';
            case 'failed':
                return 'failed';
            case 'queued':
                return 'in_progress';
            default:
                return 'failed';
        }
    }

    private resolveEventText(
        eventType: RuntimeExecutionEvent['event_type'],
        payload: Record<string, unknown>
    ): string | undefined {
        const payloadMessage =
            typeof payload.message === 'string'
                ? payload.message
                : typeof payload.error === 'string'
                ? payload.error
                : undefined;

        if (payloadMessage) return payloadMessage;

        switch (eventType) {
            case 'task.claimed':
                return 'Task claimed';
            case 'task.started':
                return 'Task started';
            case 'task.progress':
                return 'Task in progress';
            case 'task.completed':
                return 'Task completed';
            case 'task.failed':
                return 'Task failed';
            case 'task.canceled':
                return 'Task canceled';
            default:
                return undefined;
        }
    }
}
