import { describe, expect, it, vi } from 'vitest';
import type {
    ExecutionContext,
    ExecutionResult,
    IngestExecutionEventInput,
    RuntimeExecutionEvent,
    ToolCall,
} from '../core/types/runtime';
import { ACPContractAdapter } from './ACPContractAdapter';
import type { ACPSessionUpdateParams } from './types';

class FakeRuntime {
    private handlers = new Set<(event: RuntimeExecutionEvent) => void>();

    public executeResult: ExecutionResult = {
        status: 'queued',
        task_id: 'task-1',
        attempt_id: 'run-1',
    };

    public ingestResult: RuntimeExecutionEvent | null = null;

    public executeToolCall = vi.fn(
        async (_call: ToolCall, _context: ExecutionContext): Promise<ExecutionResult> => {
            return this.executeResult;
        }
    );

    onExecutionEvent(handler: (event: RuntimeExecutionEvent) => void): () => void {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }

    ingestExecutionEvent(_input: IngestExecutionEventInput): RuntimeExecutionEvent | null {
        if (this.ingestResult) {
            this.emit(this.ingestResult);
            return this.ingestResult;
        }

        return null;
    }

    emit(event: RuntimeExecutionEvent): void {
        for (const handler of this.handlers) {
            handler(event);
        }
    }
}

function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ACPContractAdapter', () => {
    it('keeps ACP toolCallId correlated to task lifecycle updates via task_id mapping', async () => {
        const runtime = new FakeRuntime();
        const updates: ACPSessionUpdateParams[] = [];

        const notifier = {
            notify: vi.fn(async (_method: 'session/update', params: ACPSessionUpdateParams) => {
                updates.push(params);
            }),
            request: vi.fn(async () => ({ decision: 'allow_once' })),
        };

        const adapter = new ACPContractAdapter({
            runtime,
            notifier,
            requestPermission: true,
        });

        const result = await adapter.executeTool(
            {
                toolCallId: 'call-1',
                toolName: 'folio_documents_add',
                args: { file_path: '/tmp/a.pdf' },
            },
            {
                sessionId: 'sess-1',
                appId: 'folio',
                userId: 'user-1',
                provider: 'gemini',
            }
        );

        expect(result.status).toBe('queued');
        expect(runtime.executeToolCall).toHaveBeenCalledOnce();

        runtime.emit({
            tool_call_id: 'different-call-id',
            task_id: 'task-1',
            attempt_id: 'run-1',
            event_type: 'task.progress',
            event_id: 'evt-progress-1',
            timestamp: new Date().toISOString(),
            payload: { message: 'Indexing' },
        });

        await flushMicrotasks();

        const progressUpdate = updates.find(
            (update) =>
                update.update.type === 'tool_call_update' &&
                update.update.status === 'in_progress' &&
                update.update.rawOutput?.message === 'Indexing'
        );

        expect(progressUpdate).toBeDefined();
        expect(progressUpdate?.update.toolCallId).toBe('call-1');

        adapter.dispose();
    });

    it('denies execution when permission is not granted and does not call runtime', async () => {
        const runtime = new FakeRuntime();
        const updates: ACPSessionUpdateParams[] = [];

        const notifier = {
            notify: vi.fn(async (_method: 'session/update', params: ACPSessionUpdateParams) => {
                updates.push(params);
            }),
            request: vi.fn(async () => ({ decision: 'deny_once' })),
        };

        const adapter = new ACPContractAdapter({
            runtime,
            notifier,
            requestPermission: true,
        });

        const result = await adapter.executeTool(
            {
                toolCallId: 'call-denied-1',
                toolName: 'folio_documents_add',
                args: { file_path: '/tmp/a.pdf' },
            },
            {
                sessionId: 'sess-1',
                appId: 'folio',
                userId: 'user-1',
            }
        );

        expect(result.status).toBe('failed');
        expect(result.error?.code).toBe('permission_denied');
        expect(runtime.executeToolCall).not.toHaveBeenCalled();

        const terminalUpdate = updates.find(
            (update) =>
                update.update.toolCallId === 'call-denied-1' &&
                update.update.type === 'tool_call_update'
        );

        expect(terminalUpdate?.update.status).toBe('failed');

        adapter.dispose();
    });

    it('bridges callback payload through runtime ingestion and returns emitted event', async () => {
        const runtime = new FakeRuntime();
        const updates: ACPSessionUpdateParams[] = [];

        runtime.ingestResult = {
            tool_call_id: 'call-callback-1',
            task_id: 'task-callback-1',
            attempt_id: 'run-3',
            event_type: 'task.completed',
            event_id: 'evt-complete-1',
            timestamp: new Date().toISOString(),
            payload: { result: 'done' },
        };

        const notifier = {
            notify: vi.fn(async (_method: 'session/update', params: ACPSessionUpdateParams) => {
                updates.push(params);
            }),
        };

        const adapter = new ACPContractAdapter({
            runtime,
            notifier,
        });

        const ingested = adapter.ingestContractCallback(
            {
                task_id: 'task-callback-1',
                tool_call_id: 'call-callback-1',
                event: 'task.completed',
                event_id: 'evt-complete-1',
                payload: { result: 'done' },
            },
            {
                sessionId: 'sess-cb-1',
            }
        );

        await flushMicrotasks();

        expect(ingested?.event_type).toBe('task.completed');

        const completedUpdate = updates.find(
            (update) =>
                update.update.toolCallId === 'call-callback-1' &&
                update.update.status === 'completed'
        );

        expect(completedUpdate).toBeDefined();

        adapter.dispose();
    });
});
