import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContractModule } from './contract';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const tempDirs: string[] = [];

describe('ContractModule capability discovery', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        for (const dir of tempDirs.splice(0, tempDirs.length)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
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
            capability: 'folio.documents.add',
            file_path: '/tmp/doc.pdf',
        });
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

    it('compileCapabilities migrates legacy capability fields', () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        const report = module.compileCapabilities([
            {
                capabilityId: 'folio.documents.add',
                name: 'Add Document',
                description: 'Queue a document.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string' },
                    },
                    required: ['file_path'],
                },
                executionMode: 'assist_then_delegate',
                intentTags: ['Documents', 'Ingestion'],
                riskLevel: 'LOW',
                trigger: {
                    event: 'trigger-agent',
                },
                deliveryMode: 'api',
                deliveryApi: {
                    method: 'post',
                    path: '/api/contracts/invoke',
                },
                preflight: {
                    requiredPreprocessing: ['OCR_PDF'],
                },
                configRequirements: {
                    requiredFields: [
                        {
                            key: 'folio_runtime_token',
                            description: 'Token used by Folio invoke runtime.',
                            source: 'runtime_context.supabase.access_token',
                            sensitive: true,
                        },
                    ],
                    optional: ['default_workspace_id'],
                    setupSteps: ['Open Folio and authenticate.'],
                    notes: ['Refresh token before expiry.'],
                },
            },
        ]);

        expect(report.output_count).toBe(1);
        expect(report.migrated_count).toBe(1);
        expect(report.warnings.some((entry) => entry.code === 'INVALID_TRIGGER_EVENT')).toBe(
            true
        );
        expect(report.capabilities[0]).toMatchObject({
            capability_id: 'folio.documents.add',
            execution_mode: 'assist_then_delegate',
            intent_tags: ['documents', 'ingestion'],
            risk_level: 'low',
            trigger: {
                event: 'task.trigger',
                route: '/webhooks/realtimex',
            },
            delivery: {
                mode: 'api',
                api: expect.objectContaining({
                    method: 'POST',
                    path: '/api/contracts/invoke',
                }),
            },
            preflight: {
                required_preprocessing: ['ocr_pdf'],
            },
            configuration: {
                required: [
                    {
                        key: 'folio_runtime_token',
                        description: 'Token used by Folio invoke runtime.',
                        source: 'runtime_context.supabase.access_token',
                        sensitive: true,
                    },
                ],
                optional: [{ key: 'default_workspace_id' }],
                setup_steps: ['Open Folio and authenticate.'],
                notes: ['Refresh token before expiry.'],
            },
        });
    });

    it('compileCapabilities strict mode throws on migration warnings', () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        expect(() =>
            module.compileCapabilities(
                [
                    {
                        capabilityId: 'folio.documents.add',
                        name: 'Add Document',
                        description: 'Queue a document.',
                        inputSchema: { type: 'object' },
                        trigger: { event: 'trigger-agent' },
                    },
                ],
                { strict: true }
            )
        ).toThrow('compileCapabilities strict mode failed');
    });

    it('setLocalCapabilityManifest caches compile report and capabilities', () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        const report = module.setLocalCapabilityManifest([
            {
                capability_id: 'folio.documents.add',
                name: 'Add Document',
                description: 'Queue a document.',
                input_schema: { type: 'object' },
                permission: 'webhook.trigger',
            },
        ]);

        expect(report.output_count).toBe(1);
        expect(module.getCompiledCapabilities()).toHaveLength(1);
        expect(module.getCapabilityCompileReport()?.output_count).toBe(1);
    });

    it('syncLocalCapabilities posts compiled catalog to main app sdk endpoint', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            jsonResponse({
                success: true,
                app_id: 'app-1',
                capability_count: 1,
            })
        );
        const module = new ContractModule(
            'http://localhost:3001',
            'Folio',
            'app-1',
            'dev-api-key'
        );
        module.setLocalCapabilityManifest([
            {
                capability_id: 'folio.documents.add',
                name: 'Add Document',
                description: 'Queue a document.',
                input_schema: { type: 'object' },
                permission: 'webhook.trigger',
            },
        ]);

        const result = await module.syncLocalCapabilities();

        expect(result.success).toBe(true);
        const [url, requestInit] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3001/sdk/local-apps/contract-capabilities');
        expect(requestInit?.method).toBe('POST');
        expect(requestInit?.headers).toMatchObject({
            Authorization: 'Bearer dev-api-key',
            'x-app-id': 'app-1',
            'x-app-name': 'Folio',
        });
    });

    it('buildSkillArtifacts emits direct local-app router instructions', () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        module.setLocalCapabilityManifest([
            {
                capability_id: 'folio.documents.add',
                name: 'Add Document',
                description: 'Queue a document for ingestion.',
                input_schema: {
                    type: 'object',
                    required: ['file_path'],
                    properties: {
                        file_path: {
                            type: 'string',
                            description: 'Absolute path to the document.',
                        },
                    },
                },
                execution_mode: 'assist_then_delegate',
                preflight: {
                    required_preprocessing: ['ocr_pdf'],
                },
                delivery: {
                    mode: 'api',
                    api: {
                        method: 'POST',
                        path: '/api/contracts/invoke',
                    },
                },
            },
        ]);

        const result = module.buildSkillArtifacts({
            rootDir: '/tmp/realtimex-sdk-skill-artifacts',
            baseUrl: 'http://127.0.0.1:5180',
        });

        expect(result.artifacts).toHaveLength(1);
        expect(result.app_index.count).toBe(1);
        expect(result.artifacts[0].metadata.router).toMatchObject({
            preflight_url: 'http://127.0.0.1:5180/api/contracts/preflight',
            invoke_url: 'http://127.0.0.1:5180/api/contracts/invoke',
            health_url: 'http://127.0.0.1:5180/api/contracts/health',
        });
        expect(result.artifacts[0].markdown).toContain(
            'POST http://127.0.0.1:5180/api/contracts/preflight'
        );
        expect(result.artifacts[0].markdown).toContain(
            'POST http://127.0.0.1:5180/api/contracts/invoke'
        );
        expect(result.artifacts[0].markdown).toContain(
            'Do not call unrelated Local App endpoints directly.'
        );
        expect(result.artifacts[0].markdown).not.toContain('contracts.delegate');
    });

    it('publishSkills writes app artifacts and preserves other app indexes', () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtx-sdk-skills-'));
        tempDirs.push(rootDir);

        const existingAppDir = path.join(rootDir, 'other-app');
        fs.mkdirSync(existingAppDir, { recursive: true });
        fs.writeFileSync(
            path.join(existingAppDir, 'index.json'),
            `${JSON.stringify(
                {
                    app_id: 'other-app',
                    app_name: 'Other App',
                    app_dir: 'other-app',
                    generated_at: '2026-03-09T00:00:00.000Z',
                    count: 1,
                    skills: [
                        {
                            name: 'other-app-ping',
                            path: 'other-app/other-app-ping/SKILL.md',
                            app_id: 'other-app',
                            capability_id: 'other.ping',
                            description: 'Ping',
                        },
                    ],
                },
                null,
                2
            )}\n`
        );

        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        module.setLocalCapabilityManifest([
            {
                capability_id: 'folio.documents.add',
                name: 'Add Document',
                input_schema: {
                    type: 'object',
                    required: ['file_path'],
                    properties: {
                        file_path: { type: 'string' },
                    },
                },
                delivery: {
                    mode: 'api',
                    api: {
                        path: '/api/contracts/invoke',
                    },
                },
            },
        ]);

        const staleDir = path.join(rootDir, 'app-1', 'stale-skill');
        fs.mkdirSync(staleDir, { recursive: true });
        fs.writeFileSync(path.join(staleDir, 'SKILL.md'), '# stale\n');

        const result = module.publishSkills({
            rootDir,
            baseUrl: 'http://127.0.0.1:5180',
        });

        expect(result.success).toBe(true);
        expect(result.files_written).toBeGreaterThan(0);
        expect(result.removed_dirs).toBe(1);

        const skillDir = path.join(rootDir, 'app-1', 'folio-folio-documents-add');
        expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(skillDir, 'skill.json'))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, 'app-1', 'index.json'))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, 'index.json'))).toBe(true);
        expect(fs.existsSync(staleDir)).toBe(false);

        const rootIndex = JSON.parse(fs.readFileSync(path.join(rootDir, 'index.json'), 'utf8'));
        expect(rootIndex.apps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ app_id: 'app-1', count: 1 }),
                expect.objectContaining({ app_id: 'other-app', count: 1 }),
            ])
        );
    });

    it('handleInvokeRequest validates required args and runs registered handler', async () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        module.setLocalCapabilityManifest([
            {
                capability_id: 'folio.documents.add',
                name: 'Add Document',
                input_schema: {
                    type: 'object',
                    required: ['file_path'],
                },
            },
        ]);

        const missing = await module.handleInvokeRequest(
            { capability_id: 'folio.documents.add', args: {} },
            {
                handlers: {
                    'folio.documents.add': async () => ({ task_id: 'task-1', status: 'queued' }),
                },
            }
        );
        expect(missing.status).toBe(400);
        expect(missing.payload.success).toBe(false);
        expect(missing.payload.code).toBe('INPUT_INVALID');

        const success = await module.handleInvokeRequest(
            {
                capability_id: 'folio.documents.add',
                args: { file_path: '/tmp/doc.pdf' },
                context: { workspace_id: 'ws-1' },
            },
            {
                handlers: {
                    'folio.documents.add': async ({ args, context }) => {
                        expect(args.file_path).toBe('/tmp/doc.pdf');
                        expect(context.workspace_id).toBe('ws-1');
                        return {
                            task_id: 'task-1',
                            status: 'queued',
                            message: 'Queued',
                        };
                    },
                },
            }
        );
        expect(success.status).toBe(200);
        expect(success.payload.success).toBe(true);
        expect(success.payload.task_id).toBe('task-1');
        expect(success.payload.task_uuid).toBe('task-1');
    });

    it('createInvokeHandler adapts to express-style req/res', async () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        module.setLocalCapabilityManifest([
            {
                capability_id: 'folio.documents.add',
                name: 'Add Document',
                input_schema: {
                    type: 'object',
                    required: ['file_path'],
                },
            },
        ]);

        const handler = module.createInvokeHandler({
            handlers: {
                'folio.documents.add': async ({ args }) => ({
                    task_id: 'task-2',
                    status: args.file_path ? 'queued' : 'failed',
                }),
            },
        });

        const jsonSpy = vi.fn();
        const statusSpy = vi.fn().mockImplementation((_status: number) => ({
            json: jsonSpy,
        }));
        await handler(
            {
                body: {
                    capability_id: 'folio.documents.add',
                    args: { file_path: '/tmp/new.pdf' },
                },
            },
            {
                status: statusSpy,
                json: jsonSpy,
            }
        );

        expect(statusSpy).toHaveBeenCalledWith(200);
        expect(jsonSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                capability_id: 'folio.documents.add',
                task_id: 'task-2',
                task_uuid: 'task-2',
            })
        );
    });

    it('handlePreflightRequest blocks when required args are missing', async () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        module.setLocalCapabilityManifest([
            {
                capability_id: 'folio.documents.add',
                name: 'Add Document',
                input_schema: {
                    type: 'object',
                    required: ['file_path'],
                },
            },
        ]);

        const result = await module.handlePreflightRequest(
            { capability_id: 'folio.documents.add', args: {} },
            { capabilities: module.getCompiledCapabilities() }
        );

        expect(result.status).toBe(400);
        expect(result.payload).toMatchObject({
            success: false,
            capability_id: 'folio.documents.add',
            decision: 'blocked',
            next_action: 'collect_required_args',
            code: 'INPUT_INVALID',
            blocking_codes: ['INPUT_INVALID'],
            missing_required_args: ['file_path'],
        });
    });

    it('handlePreflightRequest requires declared preprocessing for assist_then_delegate', async () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        module.setLocalCapabilityManifest([
            {
                capability_id: 'folio.documents.add',
                name: 'Add Document',
                input_schema: {
                    type: 'object',
                    required: ['file_path'],
                },
                execution_mode: 'assist_then_delegate',
                preflight: {
                    required_preprocessing: ['ocr_pdf'],
                },
            },
        ]);

        const blocked = await module.handlePreflightRequest(
            {
                capability_id: 'folio.documents.add',
                args: { file_path: '/tmp/doc.pdf' },
            },
            { capabilities: module.getCompiledCapabilities() }
        );
        expect(blocked.status).toBe(409);
        expect(blocked.payload).toMatchObject({
            success: false,
            decision: 'blocked',
            next_action: 'perform_preprocessing_then_invoke',
            code: 'PREPROCESSING_REQUIRED',
            required_preprocessing: ['ocr_pdf'],
        });

        const allowed = await module.handlePreflightRequest(
            {
                capability_id: 'folio.documents.add',
                args: { file_path: '/tmp/doc.pdf' },
                agentic: {
                    preprocessing: ['ocr_pdf'],
                },
            },
            { capabilities: module.getCompiledCapabilities() }
        );
        expect(allowed.status).toBe(200);
        expect(allowed.payload).toMatchObject({
            success: true,
            decision: 'assist_then_delegate',
            next_action: 'invoke',
            execution_mode: 'assist_then_delegate',
        });
    });

    it('createContractRouter exposes preflight, invoke, and health handlers', async () => {
        const module = new ContractModule('http://localhost:3001', 'Folio', 'app-1');
        module.setLocalCapabilityManifest([
            {
                capability_id: 'folio.documents.add',
                name: 'Add Document',
                input_schema: {
                    type: 'object',
                    required: ['file_path'],
                },
            },
        ]);

        const router = module.createContractRouter({
            handlers: {
                'folio.documents.add': async () => ({
                    task_id: 'task-router',
                    status: 'queued',
                }),
            },
            capabilities: module.getCompiledCapabilities(),
        });

        const preflightJson = vi.fn();
        const preflightStatus = vi.fn().mockImplementation((_status: number) => ({
            json: preflightJson,
        }));
        await router.preflight(
            {
                body: {
                    capability_id: 'folio.documents.add',
                    args: { file_path: '/tmp/doc.pdf' },
                },
            },
            { status: preflightStatus, json: preflightJson }
        );
        expect(preflightStatus).toHaveBeenCalledWith(200);
        expect(preflightJson).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                decision: 'delegate_now',
            })
        );

        const healthJson = vi.fn();
        const healthStatus = vi.fn().mockImplementation((_status: number) => ({
            json: healthJson,
        }));
        await router.health({}, { status: healthStatus, json: healthJson });
        expect(healthStatus).toHaveBeenCalledWith(200);
        expect(healthJson).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                status: 'ok',
                capability_count: 1,
            })
        );
    });
});
