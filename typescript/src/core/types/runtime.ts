import type { LocalAppContractV1, ProviderKind } from './contract';
import type { CanonicalToolDefinition } from './tooling';

export interface ToolCall {
    tool_call_id: string;
    tool_name: string;
    args: Record<string, unknown>;
}

export interface ExecutionContext {
    appId: string;
    userId: string;
    workspaceId?: string;
    requestId?: string;
    idempotencyKey?: string;
    provider?: ProviderKind;
    namespace?: string;
    metadata?: Record<string, unknown>;
}

export interface ExecutionResult {
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
}

export type LifecycleEventType =
    | 'task.claimed'
    | 'task.started'
    | 'task.progress'
    | 'task.completed'
    | 'task.failed'
    | 'task.canceled';

export interface RuntimeExecutionEvent {
    tool_call_id: string;
    task_id: string;
    attempt_id?: string;
    event_type: LifecycleEventType;
    event_id: string;
    timestamp: string;
    payload?: Record<string, unknown>;
}

export interface GetToolsInput {
    appId: string;
    provider: ProviderKind;
    namespace?: string;
}

export interface IngestExecutionEventInput {
    event?: string;
    event_type?: string;
    event_id?: string;
    task_id?: string;
    task_uuid?: string;
    attempt_id?: string | number | null;
    tool_call_id?: string;
    timestamp?: string;
    payload?: Record<string, unknown>;
    data?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface ContractRuntimeInterface {
    getContract(appId: string): Promise<LocalAppContractV1>;
    getTools(input: GetToolsInput): Promise<CanonicalToolDefinition[]>;
    executeToolCall(call: ToolCall, context: ExecutionContext): Promise<ExecutionResult>;
    onExecutionEvent(handler: (event: RuntimeExecutionEvent) => void): () => void;
}
