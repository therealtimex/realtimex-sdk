import type {
    ExecutionContext,
    ExecutionResult,
    IngestExecutionEventInput,
    RuntimeExecutionEvent,
    ToolCall,
} from '../core/types/runtime';

export type ACPToolKind =
    | 'read'
    | 'edit'
    | 'delete'
    | 'move'
    | 'search'
    | 'execute'
    | 'think'
    | 'fetch'
    | 'other';

export type ACPToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ACPTextContent {
    type: 'text';
    text: string;
}

export interface ACPSessionToolUpdate {
    type: 'tool_call' | 'tool_call_update';
    toolCallId: string;
    title?: string;
    kind?: ACPToolKind;
    status: ACPToolStatus;
    content?: ACPTextContent[];
    rawInput?: Record<string, unknown>;
    rawOutput?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
}

export interface ACPSessionUpdateParams {
    sessionId: string;
    update: ACPSessionToolUpdate;
}

export interface ACPNotifier {
    notify(method: 'session/update', params: ACPSessionUpdateParams): Promise<void>;
    request?<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
}

export interface ACPAdapterContext {
    sessionId: string;
    appId: string;
    userId: string;
    workspaceId?: string;
    provider?: 'gemini' | 'claude' | 'codex';
    namespace?: string;
}

export interface ACPToolInvocation {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    title?: string;
    kind?: ACPToolKind;
}

export interface ACPExecutionReference {
    sessionId: string;
    toolCallId: string;
    appId: string;
    userId: string;
    workspaceId?: string;
    provider?: 'gemini' | 'claude' | 'codex';
    namespace?: string;
    title?: string;
    kind?: ACPToolKind;
}

export interface PermissionOption {
    id: string;
    label: string;
    kind?: 'allow_once' | 'allow_always' | 'deny_once' | 'deny_always';
}

export interface ACPContractRuntime {
    executeToolCall(call: ToolCall, context: ExecutionContext): Promise<ExecutionResult>;
    onExecutionEvent(handler: (event: RuntimeExecutionEvent) => void): () => void;
    ingestExecutionEvent(input: IngestExecutionEventInput): RuntimeExecutionEvent | null;
}

export interface ACPContractAdapterOptions {
    runtime: ACPContractRuntime;
    notifier: ACPNotifier;
    requestPermission?: boolean;
    buildPermissionOptions?: (input: ACPToolInvocation) => PermissionOption[];
    telemetry?: ACPAdapterTelemetrySink;
}

export interface ACPAdapterTelemetryEvent {
    phase: 'execute' | 'notify' | 'permission' | 'runtime_event' | 'ingest';
    result: 'ok' | 'failed' | 'skipped';
    sessionId?: string;
    toolCallId?: string;
    toolName?: string;
    taskId?: string;
    attemptId?: string;
    eventId?: string;
    eventType?: string;
    status?: ACPToolStatus;
    error?: string;
    metadata?: Record<string, unknown>;
}

export interface ACPAdapterTelemetrySink {
    emit(event: ACPAdapterTelemetryEvent): void | Promise<void>;
}
