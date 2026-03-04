import type { ContractCapability, LocalAppContractV1, ProviderKind } from './contract';

export interface ProjectToolsInput {
    contract: LocalAppContractV1;
    provider: ProviderKind;
    appId: string;
    namespace?: string;
}

export interface CanonicalToolDefinition {
    tool_name: string;
    title: string;
    description: string;
    input_schema: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
    permission: string;
    capability_id: string;
    trigger: ContractCapability['trigger'];
}

export interface HostToolAdapter<TProviderTool, TProviderToolCall, TProviderResult> {
    toProviderTools(tools: CanonicalToolDefinition[]): TProviderTool[];
    fromProviderToolCall(call: TProviderToolCall): { tool_call_id: string; tool_name: string; args: Record<string, unknown> };
    toProviderResult(result: {
        status: 'completed' | 'failed' | 'queued';
        tool_call_id?: string;
        task_id?: string;
        attempt_id?: string;
        output?: Record<string, unknown>;
        error?: {
            code: string;
            message: string;
            retryable: boolean;
        };
    }): TProviderResult;
}
