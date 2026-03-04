import type { ACPAdapterContext, ACPNotifier, ACPToolInvocation, PermissionOption } from './types';

interface ACPPermissionBridgeOptions {
    notifier: ACPNotifier;
    enabled: boolean;
    buildPermissionOptions?: (input: ACPToolInvocation) => PermissionOption[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePermissionOptions(
    invocation: ACPToolInvocation,
    buildPermissionOptions?: (input: ACPToolInvocation) => PermissionOption[]
): PermissionOption[] {
    const built = buildPermissionOptions ? buildPermissionOptions(invocation) : undefined;
    if (built && built.length > 0) return built;

    return [
        {
            id: 'allow_once',
            label: 'Allow once',
            kind: 'allow_once',
        },
        {
            id: 'deny_once',
            label: 'Deny',
            kind: 'deny_once',
        },
    ];
}

function parseDecision(response: unknown): boolean {
    if (typeof response === 'boolean') return response;

    if (!isRecord(response)) return false;

    if (typeof response.allow === 'boolean') return response.allow;

    const decision =
        (typeof response.decision === 'string' && response.decision) ||
        (typeof response.outcome === 'string' && response.outcome) ||
        (typeof response.selected === 'string' && response.selected) ||
        '';

    const normalized = decision.trim().toLowerCase();
    if (!normalized) return false;

    return (
        normalized === 'allow' ||
        normalized === 'allow_once' ||
        normalized === 'allow_always' ||
        normalized === 'approved' ||
        normalized === 'granted'
    );
}

export class ACPPermissionBridge {
    private readonly notifier: ACPNotifier;
    private readonly enabled: boolean;
    private readonly buildPermissionOptions?: (input: ACPToolInvocation) => PermissionOption[];

    constructor(options: ACPPermissionBridgeOptions) {
        this.notifier = options.notifier;
        this.enabled = options.enabled;
        this.buildPermissionOptions = options.buildPermissionOptions;
    }

    async requestToolPermission(
        invocation: ACPToolInvocation,
        context: ACPAdapterContext
    ): Promise<boolean> {
        if (!this.enabled) return true;

        if (!this.notifier.request) {
            // Fail closed when permission prompts are required by policy.
            return false;
        }

        const options = normalizePermissionOptions(invocation, this.buildPermissionOptions);

        try {
            const response = await this.notifier.request<unknown>('session/request_permission', {
                sessionId: context.sessionId,
                title: invocation.title || invocation.toolName,
                description: `Allow tool ${invocation.toolName} to run?`,
                options,
                metadata: {
                    tool_call_id: invocation.toolCallId,
                    tool_name: invocation.toolName,
                    app_id: context.appId,
                },
            });

            return parseDecision(response);
        } catch {
            return false;
        }
    }
}
