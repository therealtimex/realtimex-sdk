/**
 * RealtimeX Local App SDK - Types
 */

export interface SDKConfig {
    realtimex?: {
        url?: string;     // Default: http://localhost:3001
        appId?: string;   // Auto-detected from RTX_APP_ID env
        appName?: string; // Auto-detected from RTX_APP_NAME env
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
