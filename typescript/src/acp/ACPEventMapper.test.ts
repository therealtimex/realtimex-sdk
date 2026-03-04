import { describe, expect, it } from 'vitest';
import { ACPEventMapper } from './ACPEventMapper';

const reference = {
    sessionId: 'sess-1',
    toolCallId: 'call-1',
    appId: 'folio',
    userId: 'user-1',
    workspaceId: 'ws-1',
    provider: 'gemini' as const,
    namespace: 'folio',
    title: 'Add document',
    kind: 'execute' as const,
};

describe('ACPEventMapper', () => {
    const mapper = new ACPEventMapper();

    it('maps contract lifecycle events to ACP statuses', () => {
        expect(mapper.mapContractEventStatus('task.claimed')).toBe('in_progress');
        expect(mapper.mapContractEventStatus('task.started')).toBe('in_progress');
        expect(mapper.mapContractEventStatus('task.progress')).toBe('in_progress');
        expect(mapper.mapContractEventStatus('task.completed')).toBe('completed');
        expect(mapper.mapContractEventStatus('task.failed')).toBe('failed');
        expect(mapper.mapContractEventStatus('task.canceled')).toBe('failed');
        expect(mapper.mapContractEventStatus('unknown.event')).toBeNull();
    });

    it('builds queued execution result as in_progress update', () => {
        const update = mapper.buildResultUpdate(
            {
                status: 'queued',
                tool_call_id: 'call-1',
                task_id: 'task-1',
                attempt_id: 'run-1',
                output: { accepted: true },
            },
            reference
        );

        expect(update.update.status).toBe('in_progress');
        expect(update.update.type).toBe('tool_call_update');
        expect(update.update.toolCallId).toBe('call-1');
        expect(update.update.content?.[0]?.text).toBe('Task queued');

        const meta = (update.update._meta as { realtimex?: Record<string, unknown> }).realtimex;
        expect(meta?.contract_event).toBe('task.started');
        expect(meta?.task_id).toBe('task-1');
        expect(meta?.attempt_id).toBe('run-1');
    });

    it('maps canceled contract event to failed ACP status with cancellation metadata', () => {
        const update = mapper.buildLifecycleUpdate(
            {
                tool_call_id: 'ignored-by-reference',
                task_id: 'task-1',
                attempt_id: 'run-1',
                event_type: 'task.canceled',
                event_id: 'evt-1',
                timestamp: new Date().toISOString(),
                payload: {
                    message: 'User cancelled',
                },
            },
            reference
        );

        expect(update).not.toBeNull();
        expect(update?.update.status).toBe('failed');
        expect(update?.update.toolCallId).toBe('call-1');
        expect(update?.update.content?.[0]?.text).toBe('User cancelled');

        const meta = (update?.update._meta as { realtimex?: Record<string, unknown> }).realtimex;
        expect(meta?.cancelled).toBe(true);
        expect(meta?.contract_event).toBe('task.canceled');
    });
});
