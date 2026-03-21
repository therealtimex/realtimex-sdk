/**
 * RealtimeX Local App SDK - Types
 */

export interface SDKConfig {
    realtimex?: {
        url?: string;     // Default: http://localhost:3001
        appId?: string;   // For production mode - from registered LocalApp
        appName?: string; // Auto-detected from RTX_APP_NAME env
        apiKey?: string;  // For dev mode - API key from Settings > API Keys
    };
    defaultPort?: number; // Default port for PortModule (default: 8080)
    permissions?: string[]; // List of required permissions
    contract?: SDKContractConfig;
}

export interface SDKContractConfig {
    callbackSecret?: string;
    signCallbacksByDefault?: boolean;
    capabilities?: ContractCapabilityInput[];
    autoMigrateCapabilities?: boolean;
    strictCapabilityMigration?: boolean;
    autoSyncCapabilities?: boolean;
}

export interface Activity {
    id: string;
    raw_data: Record<string, unknown>;
    old_data?: Record<string, unknown>;
    status: 'pending' | 'claimed' | 'completed' | 'failed';
    locked_by?: string;
    locked_at?: string;
    completed_at?: string;
    error_message?: string;
    result?: Record<string, unknown>;
    created_at: string;
}

export interface TriggerAgentPayload {
    raw_data: Record<string, unknown>;
    auto_run?: boolean;
    agent_name?: string;
    workspace_slug?: string;
    thread_slug?: string;
    prompt?: string;
    event_id?: string;
    attempt_id?: string | number;
}

export interface TriggerAgentResponse {
    success: boolean;
    task_uuid?: string;
    task_id?: string;
    capability_id?: string;
    event_id?: string;
    attempt_id?: string;
    event_type?: ContractEventType | string;
    contract_version?: string;
    calendar_event_uuid?: string;
    auto_run?: boolean;
    message?: string;
    error?: string;
}

export type ContractEventType =
    | 'task.trigger'
    | 'system.ping'
    | 'task.claimed'
    | 'task.started'
    | 'task.progress'
    | 'task.completed'
    | 'task.failed'
    | 'task.canceled';

export interface ContractCallbackMetadata {
    event_id_header?: string;
    signature_header?: string;
    signature_algorithm?: string;
    signature_message?: string;
    attempt_id_format?: string;
    idempotency?: string;
}

export interface ContractCapabilityTrigger {
    event: string;
    route?: string;
    payload_template?: Record<string, unknown>;
}

export interface ContractCapabilityPreflight {
    required_preprocessing?: string[];
    requiredPreprocessing?: string[];
}

export interface ContractDeliveryApiConfig {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | string;
    path?: string;
    headers?: Record<string, string>;
    payload_template?: Record<string, unknown>;
}

export interface ContractDeliveryConfig {
    mode?: 'webhook' | 'api' | string;
    webhook?: {
        route?: string;
    } | null;
    api?: ContractDeliveryApiConfig | null;
}

export interface ContractNetworkPolicy {
    allow_domains?: string[];
    allowDomains?: string[];
    allow_localhost?: boolean;
    allowLocalhost?: boolean;
}

export interface ContractArtifactPolicy {
    required?: string[];
    provenance_required?: boolean;
    provenanceRequired?: boolean;
}

export interface ContractApprovalPolicy {
    mode?: 'none' | 'required' | 'human_required';
    one_time?: boolean;
    oneTime?: boolean;
    ttl_ms?: number;
    ttlMs?: number;
}

export interface ContractIdempotencyPolicy {
    key_fields?: string[];
    keyFields?: string[];
}

export interface ContractCapabilityConfigEntry {
    key: string;
    description?: string;
    source?: string;
    sensitive?: boolean;
}

export interface ContractCapabilityConfiguration {
    required?: Array<ContractCapabilityConfigEntry | string>;
    optional?: Array<ContractCapabilityConfigEntry | string>;
    required_fields?: Array<ContractCapabilityConfigEntry | string>;
    requiredFields?: Array<ContractCapabilityConfigEntry | string>;
    optional_fields?: Array<ContractCapabilityConfigEntry | string>;
    optionalFields?: Array<ContractCapabilityConfigEntry | string>;
    setup_steps?: string[];
    setupSteps?: string[];
    steps?: string[];
    notes?: string[];
}

export interface ContractCapability {
    capability_id: string;
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
    permission?: string;
    trigger?: ContractCapabilityTrigger;
    preflight?: {
        required_preprocessing?: string[];
    } | null;
    delivery?: ContractDeliveryConfig | null;
    domain?: string;
    intent_tags?: string[];
    execution_mode?: 'delegate_only' | 'assist_then_delegate' | 'agent_only';
    allowed_preprocessing?: string[];
    allowed_side_effects?: string[];
    network_policy?: ContractNetworkPolicy | null;
    artifact_policy?: ContractArtifactPolicy | null;
    approval_policy?: ContractApprovalPolicy | null;
    idempotency?: ContractIdempotencyPolicy | null;
    error_codes?: string[];
    configuration?: ContractCapabilityConfiguration | null;
    tags?: string[];
    examples?: string[];
    risk_level?: 'low' | 'medium' | 'high' | null;
    enabled?: boolean;
}

export interface ContractCapabilityInput extends Partial<ContractCapability> {
    id?: string;
    capabilityId?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    deliveryMode?: 'webhook' | 'api' | string;
    deliveryApi?: ContractDeliveryApiConfig | null;
    executionMode?: 'delegate_only' | 'assist_then_delegate' | 'agent_only' | string;
    allowedPreprocessing?: string[];
    allowedSideEffects?: string[];
    networkPolicy?: ContractNetworkPolicy | null;
    artifactPolicy?: ContractArtifactPolicy | null;
    approvalPolicy?: ContractApprovalPolicy | null;
    idempotencyPolicy?: ContractIdempotencyPolicy | null;
    errorCodes?: string[];
    config_requirements?: ContractCapabilityConfiguration | null;
    configRequirements?: ContractCapabilityConfiguration | null;
    intentTags?: string[];
    riskLevel?: 'low' | 'medium' | 'high' | null | string;
}

export interface CapabilityMigrationWarning {
    code:
        | 'INVALID_CAPABILITY'
        | 'MISSING_CAPABILITY_ID'
        | 'INVALID_TRIGGER_EVENT'
        | 'INVALID_EXECUTION_MODE'
        | 'INVALID_RISK_LEVEL';
    capability_id?: string;
    index: number;
    message: string;
}

export interface CompileCapabilitiesOptions {
    strict?: boolean;
    defaultTriggerRoute?: string;
}

export interface CompiledCapabilitiesResult {
    contract_version: 'local-app-contract/v1';
    capabilities: ContractCapability[];
    warnings: CapabilityMigrationWarning[];
    input_count: number;
    output_count: number;
    migrated_count: number;
    dropped_count: number;
}

export interface ContractCapabilitySyncResponse {
    success: boolean;
    app_id?: string;
    contract_version?: string;
    capability_count?: number;
    updated_at?: string;
    code?: string;
    error?: string;
}

export interface LocalAppContractDefinition {
    id: string;
    version: string;
    strictness?: 'compatible' | 'strict';
    events: Record<string, ContractEventType>;
    supported_events: ContractEventType[];
    supported_legacy_events: string[];
    aliases: Record<string, ContractEventType>;
    status_map: Record<string, string>;
    legacy_action_map: Record<ContractEventType, string>;
    catalog_hash?: string;
    capability_count?: number;
    capabilities?: ContractCapability[];
    callback?: ContractCallbackMetadata;
}

export interface LocalAppContractResponse {
    success: boolean;
    contract: LocalAppContractDefinition;
}

export interface LocalAppCapabilitiesResponse {
    success: boolean;
    contract_version: string;
    strictness?: 'compatible' | 'strict';
    catalog_hash?: string;
    count: number;
    capabilities: ContractCapability[];
}

export interface LocalAppCapabilitySearchResponse extends LocalAppCapabilitiesResponse {
    query: string;
}

export interface LocalAppCapabilityDetailResponse {
    success: boolean;
    contract_version: string;
    strictness?: 'compatible' | 'strict';
    catalog_hash?: string;
    capability: ContractCapability;
}

export interface ContractInvokePayload {
    capability_id: string;
    args?: Record<string, unknown>;
    auto_run?: boolean;
    agent_name?: string;
    workspace_slug?: string;
    thread_slug?: string;
    prompt?: string;
    event_id?: string;
    attempt_id?: string | number;
}

export interface ContractInvokeRequestBody {
    capability_id?: string;
    capabilityId?: string;
    capability?: string;
    args?: Record<string, unknown>;
    context?: Record<string, unknown>;
    contract?: Record<string, unknown>;
    payload?: {
        raw_data?: {
            capability?: string;
            capability_id?: string;
            args?: Record<string, unknown>;
            context?: Record<string, unknown>;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface ContractPreflightRequestBody extends ContractInvokeRequestBody {
    agentic?: {
        preprocessing?: string[];
        [key: string]: unknown;
    };
}

export interface ContractInvokeHandlerInput {
    capability_id: string;
    args: Record<string, unknown>;
    context: Record<string, unknown>;
    contract: Record<string, unknown> | null;
    capability: ContractCapability;
    requestBody: ContractInvokeRequestBody;
    request?: unknown;
}

export interface ContractInvokeSuccessResult {
    success?: true;
    task_id?: string;
    task_uuid?: string;
    status?: string;
    message?: string;
    [key: string]: unknown;
}

export interface ContractInvokeErrorResult {
    success?: false;
    code?: string;
    error?: string;
    status?: number;
    [key: string]: unknown;
}

export type ContractInvokeCapabilityHandler = (
    input: ContractInvokeHandlerInput
) => Promise<ContractInvokeSuccessResult | ContractInvokeErrorResult | void> | ContractInvokeSuccessResult | ContractInvokeErrorResult | void;

export interface ContractPreflightHandlerOptions {
    capabilities?: ContractCapabilityInput[];
}

export interface ContractInvokeHandlerOptions {
    handlers: Record<string, ContractInvokeCapabilityHandler>;
    capabilities?: ContractCapabilityInput[];
}

export interface ContractSkillRouterMetadata {
    base_url: string;
    preflight_path: string;
    invoke_path: string;
    health_path: string;
    preflight_url: string;
    invoke_url: string;
    health_url: string;
}

export interface ContractSkillMetadata {
    schema: 'agentskills.io/v1';
    name: string;
    description: string;
    app_id: string | null;
    app_name: string | null;
    capability_id: string | null;
    contract_version: string;
    execution_mode: 'delegate_only' | 'assist_then_delegate' | 'agent_only';
    domain: string;
    intent_tags: string[];
    allowed_preprocessing: string[];
    allowed_side_effects: string[];
    network_policy: ContractCapability['network_policy'];
    artifact_policy: ContractCapability['artifact_policy'];
    approval_policy: ContractCapability['approval_policy'];
    idempotency: ContractCapability['idempotency'];
    error_codes: string[];
    configuration: ContractCapability['configuration'];
    input_schema: Record<string, unknown> | null;
    output_schema: Record<string, unknown> | null;
    trigger: ContractCapability['trigger'] | null;
    delivery: ContractCapability['delivery'];
    preflight: ContractCapability['preflight'];
    permission: string | null;
    risk_level: ContractCapability['risk_level'];
    tags: string[];
    examples: string[];
    router: ContractSkillRouterMetadata;
    generated_at: string;
}

export interface ContractSkillArtifact {
    name: string;
    app_id: string;
    app_name: string;
    capability_id: string;
    app_dir: string;
    skill_dir: string;
    markdown_path: string;
    metadata_path: string;
    markdown: string;
    metadata: ContractSkillMetadata;
}

export interface ContractSkillAppIndexEntry {
    name: string;
    path: string;
    app_id: string;
    capability_id: string;
    description: string | null;
}

export interface ContractSkillAppIndex {
    app_id: string;
    app_name: string;
    app_dir: string;
    generated_at: string;
    count: number;
    skills: ContractSkillAppIndexEntry[];
}

export interface ContractSkillRootIndexAppEntry {
    app_id: string;
    app_name: string;
    app_dir: string;
    count: number;
}

export interface ContractSkillRootIndex {
    schema: 'agentskills.io/catalog-v1';
    generated_at: string;
    root_dir: string;
    apps: ContractSkillRootIndexAppEntry[];
}

export interface ContractBuildSkillArtifactsOptions {
    capabilities?: ContractCapabilityInput[];
    strict?: boolean;
    rootDir?: string;
    cleanupStaleSkills?: boolean;
    baseUrl?: string;
    preflightPath?: string;
    invokePath?: string;
    healthPath?: string;
    env?: Record<string, string | undefined>;
}

export interface ContractBuildSkillArtifactsResult {
    root_dir: string;
    app_id: string;
    app_name: string;
    app_dir: string;
    artifacts: ContractSkillArtifact[];
    app_index: ContractSkillAppIndex;
}

export interface ContractPublishSkillsResult extends ContractBuildSkillArtifactsResult {
    success: true;
    files_written: number;
    removed_dirs: number;
    root_index: ContractSkillRootIndex;
}

export interface ContractPreflightCheck {
    code: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    details?: Record<string, unknown>;
}

export type ContractPreflightDecision =
    | 'delegate_now'
    | 'assist_then_delegate'
    | 'blocked';

export interface ContractPreflightResponsePayload {
    success: boolean;
    capability_id: string;
    decision: ContractPreflightDecision;
    next_action?: string;
    execution_mode?: 'delegate_only' | 'assist_then_delegate' | 'agent_only';
    checks: ContractPreflightCheck[];
    required_preprocessing?: string[];
    blocking_codes?: string[];
    code?: string;
    error?: string;
    missing_required_args?: string[];
    [key: string]: unknown;
}

export interface ContractInvokeResponsePayload {
    success: boolean;
    capability_id: string;
    task_id?: string;
    task_uuid?: string;
    status?: string;
    message?: string;
    code?: string;
    error?: string;
    missing_required_args?: string[];
    [key: string]: unknown;
}

export interface ContractHealthResponsePayload {
    success: true;
    status: 'ok';
    contract_version: string;
    app_id?: string;
    app_name?: string;
    capability_count: number;
}

export interface ContractRouterHandlers {
    preflight: (
        req: { body?: ContractPreflightRequestBody },
        res: {
            status?: (statusCode: number) => { json: (payload: ContractPreflightResponsePayload) => unknown } | unknown;
            json?: (payload: ContractPreflightResponsePayload) => unknown;
        }
    ) => Promise<void>;
    invoke: (
        req: { body?: ContractInvokeRequestBody },
        res: {
            status?: (statusCode: number) => { json: (payload: ContractInvokeResponsePayload) => unknown } | unknown;
            json?: (payload: ContractInvokeResponsePayload) => unknown;
        }
    ) => Promise<void>;
    health: (
        req: unknown,
        res: {
            status?: (statusCode: number) => { json: (payload: ContractHealthResponsePayload) => unknown } | unknown;
            json?: (payload: ContractHealthResponsePayload) => unknown;
        }
    ) => Promise<void>;
    handlePreflightRequest: (
        body: ContractPreflightRequestBody,
        request?: unknown
    ) => Promise<{ status: number; payload: ContractPreflightResponsePayload }>;
    handleInvokeRequest: (
        body: ContractInvokeRequestBody,
        request?: unknown
    ) => Promise<{ status: number; payload: ContractInvokeResponsePayload }>;
    handleHealthRequest: (
        request?: unknown
    ) => Promise<{ status: number; payload: ContractHealthResponsePayload }>;
}

export interface Agent {
    slug: string;
    name: string;
    description?: string;
    hub_id?: string;
}

export interface Workspace {
    id: number;
    slug: string;
    name: string;
    type: string;
    created_at: string;
}

export interface Thread {
    id: number;
    slug: string;
    name: string;
    created_at: string;
}

export interface TaskRun {
    id: number;
    attempt_id?: string;
    agent_name: string;
    workspace_slug: string;
    thread_slug?: string;
    status: string;
    started_at?: string;
    completed_at?: string;
    error?: string;
}

export interface Task {
    uuid: string;
    title: string;
    status: string;
    action_type: string;
    source_app: string;
    error?: string;
    created_at: string;
    updated_at: string;
    runs: TaskRun[];
}

export interface TTSOptions {
    /** Voice ID (provider-specific) */
    voice?: string;
    /** Model ID (provider-specific) */
    model?: string;
    /** Speech speed (0.5-2.0) */
    speed?: number;
    /** TTS provider ID */
    provider?: string;
    /** Language code (e.g., 'en', 'es', 'fr') - for Supertonic */
    language?: string;
    /** Quality level (1-20) - for Supertonic num_inference_steps */
    num_inference_steps?: number;
}

export interface TTSProviderConfig {
    /** Available voice/speaker IDs */
    voices: string[];
    /** Supported languages (for multilingual providers) */
    languages?: string[];
    /** Speed range */
    speed?: { min: number; max: number; default: number };
    /** Quality range (for providers that support it) */
    quality?: { min: number; max: number; default: number; description?: string };
}

export interface TTSProvider {
    /** Provider ID (e.g., 'elevenlabs', 'supertonic_local') */
    id: string;
    /** Display name */
    name: string;
    /** Provider type: 'server' (remote API) or 'client' (local) */
    type: 'server' | 'client';
    /** Whether provider is configured and ready */
    configured: boolean;
    /** Whether streaming is supported */
    supportsStreaming: boolean;
    /** Optional note about provider requirements */
    note?: string;
    /** Configuration options */
    config?: TTSProviderConfig;
}

export interface TTSProvidersResponse {
    success: boolean;
    providers: TTSProvider[];
    default: string;
    error?: string;
}

export interface TTSChunk {
    /** Chunk index (0-based) */
    index: number;
    /** Total number of chunks */
    total: number;
    /** Decoded audio data (ArrayBuffer) - ready for playback */
    audio: ArrayBuffer;
    /** Audio MIME type */
    mimeType: string;
}


export interface TTSChunkEvent {
    type: 'info' | 'chunk' | 'error' | 'done';
    data: TTSChunk | { totalChunks: number } | { error: string };
}

export interface STTListenOptions {
    /** STT provider (e.g., 'native', 'whisper', 'groq') */
    provider?: string;
    /** Language code (e.g., 'en-US') */
    language?: string;
    /** Specific model ID (e.g., 'onnx-community/whisper-tiny.en') */
    model: string;
    /** Timeout in milliseconds (default: 60000) */
    timeout?: number;
}

export interface STTModel {
    id: string;
    name: string;
    provider?: string; // Optional if nested under provider
    description?: string;
    language?: string;
    size?: string;
    recommended?: boolean;
}

export interface STTProvider {
    id: string; // 'native' | 'whisper' | 'groq'
    name: string;
    description?: string;
    models: STTModel[];
}

export interface STTProvidersResponse {
    success: boolean;
    providers: STTProvider[];
    error?: string;
}

export interface STTModelsResponse {
    success: boolean;
    models: STTModel[];
    error?: string;
}

export interface STTResponse {
    success: boolean;
    /** Transcribed text */
    text: string;
    error?: string;
}
