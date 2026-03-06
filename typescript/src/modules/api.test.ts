import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiModule, PermissionDeniedError } from './api';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('ApiModule permission handling', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('limits PERMISSION_REQUIRED retries to one escalation request', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        fetchMock
            .mockResolvedValueOnce(
                jsonResponse(
                    {
                        error: 'PERMISSION_REQUIRED',
                        permission: 'api.agents.read',
                        message: 'Permission required',
                    },
                    403
                )
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    granted: true,
                })
            )
            .mockResolvedValueOnce(
                jsonResponse(
                    {
                        error: 'PERMISSION_REQUIRED',
                        permission: 'api.agents.read',
                        message: 'Permission still required',
                    },
                    403
                )
            );

        const module = new ApiModule(
            'http://localhost:3001',
            'folio-app',
            'Folio',
            'dev-api-key'
        );

        await expect(module.getAgents()).rejects.toEqual(
            expect.objectContaining({
                name: 'PermissionDeniedError',
                permission: 'api.agents.read',
                code: 'PERMISSION_REQUIRED',
            })
        );

        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
