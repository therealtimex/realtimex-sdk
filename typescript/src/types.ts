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
    contract?: {
        callbackSecret?: string;
        signCallbacksByDefault?: boolean;
    };
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

export interface LocalAppContractDefinition {
    id: string;
    version: string;
    events: Record<string, ContractEventType>;
    supported_events: ContractEventType[];
    supported_legacy_events: string[];
    aliases: Record<string, ContractEventType>;
    status_map: Record<string, string>;
    legacy_action_map: Record<ContractEventType, string>;
    callback?: ContractCallbackMetadata;
}

export interface LocalAppContractResponse {
    success: boolean;
    contract: LocalAppContractDefinition;
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
