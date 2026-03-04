import { describe, expect, it, vi } from 'vitest';
import { ACPPermissionBridge } from './ACPPermissionBridge';

const invocation = {
    toolCallId: 'call-1',
    toolName: 'folio_documents_add',
    args: { file_path: '/tmp/a.pdf' },
    title: 'Add PDF',
    kind: 'execute' as const,
};

const context = {
    sessionId: 'sess-1',
    appId: 'folio',
    userId: 'user-1',
};

describe('ACPPermissionBridge', () => {
    it('returns true when permission bridge is disabled', async () => {
        const request = vi.fn();
        const bridge = new ACPPermissionBridge({
            notifier: {
                notify: vi.fn(),
                request,
            },
            enabled: false,
        });

        const allowed = await bridge.requestToolPermission(invocation, context);
        expect(allowed).toBe(true);
        expect(request).not.toHaveBeenCalled();
    });

    it('fails closed when permission is enabled but notifier.request is missing', async () => {
        const bridge = new ACPPermissionBridge({
            notifier: {
                notify: vi.fn(),
            },
            enabled: true,
        });

        const allowed = await bridge.requestToolPermission(invocation, context);
        expect(allowed).toBe(false);
    });

    it('allows execution when request_permission returns allow decision', async () => {
        const request = vi.fn().mockResolvedValue({ decision: 'allow_once' });
        const bridge = new ACPPermissionBridge({
            notifier: {
                notify: vi.fn(),
                request,
            },
            enabled: true,
        });

        const allowed = await bridge.requestToolPermission(invocation, context);

        expect(allowed).toBe(true);
        expect(request).toHaveBeenCalledOnce();
        expect(request).toHaveBeenCalledWith('session/request_permission', expect.objectContaining({
            sessionId: 'sess-1',
            title: 'Add PDF',
        }));
    });

    it('denies execution when request_permission returns non-allow decision', async () => {
        const request = vi.fn().mockResolvedValue({ decision: 'deny_once' });
        const bridge = new ACPPermissionBridge({
            notifier: {
                notify: vi.fn(),
                request,
            },
            enabled: true,
        });

        const allowed = await bridge.requestToolPermission(invocation, context);
        expect(allowed).toBe(false);
    });

    it('denies execution when request_permission throws', async () => {
        const request = vi.fn().mockRejectedValue(new Error('transport down'));
        const bridge = new ACPPermissionBridge({
            notifier: {
                notify: vi.fn(),
                request,
            },
            enabled: true,
        });

        const allowed = await bridge.requestToolPermission(invocation, context);
        expect(allowed).toBe(false);
    });
});
