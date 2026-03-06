import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContractRuntime } from './ContractRuntime';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function buildContractPayload() {
    return {
        success: true,
        contract: {
            contract_version: 'local-app-contract/v1',
            strictness: 'compatible',
            supported_contract_events: ['task.trigger'],
            capabilities: [
                {
                    capability_id: 'folio.documents.add',
                    name: 'Add Document to Folio',
                    description: 'Queue document ingestion.',
                    permission: 'webhook.trigger',
                    input_schema: {
                        type: 'object',
                        required: ['file_path'],
                        properties: {
                            file_path: { type: 'string' },
                        },
                    },
                    trigger: {
                        event: 'task.trigger',
                        route: '/webhooks/realtimex',
                        payload_template: {
                            auto_run: false,
                            raw_data: {
                                operation: 'documents.ingest',
                            },
                        },
                    },
                },
            ],
        },
    };
}

describe('ContractRuntime.executeToolCall', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds task.trigger payload with capability_id and returns queued for task_uuid', async () => {
        const webhookBodies: Array<Record<string, unknown>> = [];
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/contracts/local-app/v1')) {
                return jsonResponse(buildContractPayload());
            }
            if (url.endsWith('/webhooks/realtimex')) {
                webhookBodies.push(JSON.parse(String(init?.body || '{}')));
                return jsonResponse({
                    success: true,
                    task_uuid: 'task-1',
                    attempt_id: 'run-1',
                    event_type: 'task.claimed',
                    message: 'Queued',
                });
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const runtime = new ContractRuntime({
            baseUrl: 'http://localhost:3001',
            appId: 'folio',
            appName: 'Folio',
            permissions: ['webhook.trigger'],
            fetchImpl: fetchMock as unknown as typeof fetch,
            retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
        });

        const tools = await runtime.getTools({
            appId: 'folio',
            provider: 'gemini',
            namespace: 'folio',
        });

        const result = await runtime.executeToolCall(
            {
                tool_call_id: 'call-1',
                tool_name: tools[0].tool_name,
                args: {
                    file_path: '/tmp/po.pdf',
                },
            },
            {
                appId: 'folio',
                userId: 'user-1',
                workspaceId: 'workspace-1',
                requestId: 'request-1',
                provider: 'gemini',
                namespace: 'folio',
                metadata: { source: 'test' },
            }
        );

        expect(result.status).toBe('queued');
        expect(result.task_id).toBe('task-1');
        expect(result.attempt_id).toBe('run-1');
        expect(fetchMock).toHaveBeenCalledTimes(2);

        const webhookBody = webhookBodies[0];
        expect(webhookBody.event).toBe('task.trigger');
        expect(webhookBody.payload).toMatchObject({
            auto_run: false,
            raw_data: {
                capability_id: 'folio.documents.add',
                operation: 'documents.ingest',
                tool_name: tools[0].tool_name,
                tool_call_id: 'call-1',
                args: {
                    file_path: '/tmp/po.pdf',
                },
                context: {
                    app_id: 'folio',
                    user_id: 'user-1',
                    workspace_id: 'workspace-1',
                    request_id: 'request-1',
                    metadata: { source: 'test' },
                },
            },
        });
    });

    it('fails validation when required fields are missing', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/contracts/local-app/v1')) {
                return jsonResponse(buildContractPayload());
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const runtime = new ContractRuntime({
            baseUrl: 'http://localhost:3001',
            appId: 'folio',
            appName: 'Folio',
            permissions: ['webhook.trigger'],
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        const tools = await runtime.getTools({
            appId: 'folio',
            provider: 'gemini',
            namespace: 'folio',
        });

        const result = await runtime.executeToolCall(
            {
                tool_call_id: 'call-invalid-1',
                tool_name: tools[0].tool_name,
                args: {},
            },
            {
                appId: 'folio',
                userId: 'user-1',
                provider: 'gemini',
                namespace: 'folio',
            }
        );

        expect(result.status).toBe('failed');
        expect(result.error).toMatchObject({
            code: 'tool_validation_error',
            retryable: false,
        });
        expect(result.error?.message).toContain('Tool input validation failed');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries webhook trigger on 5xx responses', async () => {
        let webhookAttempts = 0;

        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/contracts/local-app/v1')) {
                return jsonResponse(buildContractPayload());
            }
            if (url.endsWith('/webhooks/realtimex')) {
                webhookAttempts += 1;
                if (webhookAttempts === 1) {
                    return jsonResponse({ error: 'Temporary outage' }, 500);
                }
                return jsonResponse({
                    success: true,
                    task_uuid: 'task-retry-1',
                    event_type: 'task.claimed',
                });
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const runtime = new ContractRuntime({
            baseUrl: 'http://localhost:3001',
            appId: 'folio',
            appName: 'Folio',
            permissions: ['webhook.trigger'],
            fetchImpl: fetchMock as unknown as typeof fetch,
            retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
        });

        const tools = await runtime.getTools({
            appId: 'folio',
            provider: 'gemini',
            namespace: 'folio',
        });

        const result = await runtime.executeToolCall(
            {
                tool_call_id: 'call-retry-1',
                tool_name: tools[0].tool_name,
                args: {
                    file_path: '/tmp/retry.pdf',
                },
            },
            {
                appId: 'folio',
                userId: 'user-1',
                provider: 'gemini',
                namespace: 'folio',
            }
        );

        expect(result.status).toBe('queued');
        expect(result.task_id).toBe('task-retry-1');
        expect(webhookAttempts).toBe(2);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
