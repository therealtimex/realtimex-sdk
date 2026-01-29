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
}

export interface TriggerAgentResponse {
    success: boolean;
    task_uuid?: string;
    calendar_event_uuid?: string;
    auto_run?: boolean;
    message?: string;
    error?: string;
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
