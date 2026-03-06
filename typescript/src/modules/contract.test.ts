import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContractModule, hashContractPayload } from './contract';
import { PermissionDeniedError } from './api';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('ContractModule capability discovery', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('lists capabilities and caches catalog response', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            jsonResponse({
                success: true,
                contract_version: 'local-app-contract/v1',
                catalog_hash: 'hash-1',
                count: 1,
                capabilities: [
                    {
                        capability_id: 'folio.documents.add',
                        name: 'Add Document',
                        input_schema: { type: 'object' },
                    },
                ],
            })
        );

        const module = new ContractModule(
            'http://localhost:3001',
            'Folio',
            'app-1',
            'dev-api-key'
        );

        const first = await module.listCapabilities();
        const second = await module.listCapabilities();

        expect(first).toHaveLength(1);
        expect(second).toEqual(first);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, requestInit] = fetchMock.mock.calls[0];
        expect(String(url)).toBe(
            'http://localhost:3001/contracts/local-app/v1/capabilities'
        );
        expect(requestInit?.method).toBe('GET');
        expect(requestInit?.headers).toMatchObject({
            Authorization: 'Bearer dev-api-key',
            'x-app-id': 'app-1',
        });
        expect(module.getCachedCatalogHash()).toBe('hash-1');
    });

    it('hydrates capability cache from getLocalAppV1 contract payload', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            jsonResponse({
                success: true,
                contract: {
                    id: 'local-app-contract/v1',
                    version: 'local-app-contract/v1',
                    strictness: 'strict',
                    catalog_hash: 'hash-from-contract',
                    events: {
                        TASK_TRIGGER: 'task.trigger',
                    },
                    supported_events: ['task.trigger'],
                    supported_legacy_events: ['trigger-agent'],
                    aliases: {
                        'trigger-agent': 'task.trigger',
                    },
                    status_map: {},
                    legacy_action_map: {
                        'task.trigger': 'trigger-agent',
                    },
                    capabilities: [
                        {
                            capability_id: 'folio.documents.add',
                            name: 'Add Document',
                            input_schema: { type: 'object' },
                        },
                    ],
                },
            })
        );

        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        await module.getLocalAppV1();
        const capabilities = await module.listCapabilities();

        expect(capabilities).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(module.getCachedCatalogHash()).toBe('hash-from-contract');
    });

    it('searches capabilities through contract endpoint', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            jsonResponse({
                success: true,
                contract_version: 'local-app-contract/v1',
                query: 'purchase order',
                count: 1,
                capabilities: [
                    {
                        capability_id: 'folio.documents.add',
                        name: 'Add Document',
                        input_schema: { type: 'object' },
                    },
                ],
            })
        );

        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        const capabilities = await module.searchCapabilities('purchase order');

        expect(capabilities).toHaveLength(1);
        const [url] = fetchMock.mock.calls[0];
        expect(String(url)).toBe(
            'http://localhost:3001/contracts/local-app/v1/capabilities/search?q=purchase%20order'
        );
    });

    it('describes capability by id', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            jsonResponse({
                success: true,
                contract_version: 'local-app-contract/v1',
                capability: {
                    capability_id: 'folio.documents.add',
                    name: 'Add Document',
                    input_schema: { type: 'object' },
                },
            })
        );

        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        const capability = await module.describeCapability('folio.documents.add');

        expect(capability.capability_id).toBe('folio.documents.add');
        const [url] = fetchMock.mock.calls[0];
        expect(String(url)).toBe(
            'http://localhost:3001/contracts/local-app/v1/capabilities/folio.documents.add'
        );
    });

    it('invokes capability through task.trigger webhook payload', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            jsonResponse({
                success: true,
                task_uuid: 'task-1',
                capability_id: 'folio.documents.add',
            })
        );

        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        const result = await module.invoke({
            capability_id: 'folio.documents.add',
            args: {
                file_path: '/tmp/doc.pdf',
            },
        });

        expect(result.success).toBe(true);
        const [url, requestInit] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3001/webhooks/realtimex');
        expect(requestInit?.method).toBe('POST');

        const parsedBody = JSON.parse(String(requestInit?.body || '{}'));
        expect(parsedBody.event).toBe('task.trigger');
        expect(parsedBody.payload?.raw_data).toMatchObject({
            capability_id: 'folio.documents.add',
            file_path: '/tmp/doc.pdf',
        });
    });

    it('uses stable hash serialization regardless of object key order', () => {
        const left = hashContractPayload({ b: 1, a: 2 });
        const right = hashContractPayload({ a: 2, b: 1 });
        expect(left).toBe(right);
    });

    it('guards permission-required recursion to one retry', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        fetchMock
            // initial request gets permission required
            .mockResolvedValueOnce(
                jsonResponse(
                    {
                        error: 'PERMISSION_REQUIRED',
                        permission: 'api.contracts',
                        message: 'Need contracts permission',
                    },
                    403
                )
            )
            // permission request is granted
            .mockResolvedValueOnce(
                jsonResponse({
                    granted: true,
                })
            )
            // retry still returns permission required
            .mockResolvedValueOnce(
                jsonResponse(
                    {
                        error: 'PERMISSION_REQUIRED',
                        permission: 'api.contracts',
                        message: 'Need contracts permission',
                    },
                    403
                )
            );

        const module = new ContractModule(
            'http://localhost:3001',
            'Folio',
            'app-1',
            'dev-api-key'
        );

        await expect(module.listCapabilities()).rejects.toBeInstanceOf(
            PermissionDeniedError
        );
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('validates invoke auto_run requirements', async () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        await expect(
            module.invoke({
                capability_id: 'folio.documents.add',
                auto_run: true,
            })
        ).rejects.toThrow('auto_run requires agent_name and workspace_slug');
    });

    it('rejects empty capability search query', async () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        await expect(module.searchCapabilities('   ')).rejects.toThrow(
            'searchCapabilities requires a non-empty query'
        );
    });
});
