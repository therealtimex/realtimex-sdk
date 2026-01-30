/**
 * API Module - Call RealtimeX public APIs
 */

import { Agent, Workspace, Thread, Task } from '../types';

/**
 * Error thrown when a permission is permanently denied
 */
export class PermissionDeniedError extends Error {
    public readonly permission: string;
    public readonly code: string;

    constructor(permission: string, message?: string, code: string = 'PERMISSION_DENIED') {
        super(message || `Permission '${permission}' was denied`);
        this.name = 'PermissionDeniedError';
        this.permission = permission;
        this.code = code;
    }
}

/**
 * Error thrown when a permission needs to be granted
 */
export class PermissionRequiredError extends Error {
    public readonly permission: string;
    public readonly code: string;

    constructor(permission: string, message?: string, code: string = 'PERMISSION_REQUIRED') {
        super(message || `Permission '${permission}' is required`);
        this.name = 'PermissionRequiredError';
        this.permission = permission;
        this.code = code;
    }
}

export class ApiModule {
    private realtimexUrl: string;
    private appId: string;
    private appName: string;
    private apiKey?: string;

    constructor(realtimexUrl: string, appId: string, appName?: string, apiKey?: string) {
        this.realtimexUrl = realtimexUrl.replace(/\/$/, '');
        this.appId = appId;
        this.appName = appName || process.env.RTX_APP_NAME || 'Local App';
        this.apiKey = apiKey;
    }

    private getHeaders(): HeadersInit {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        if (this.appId) {
            headers['x-app-id'] = this.appId;
        }
        return headers;
    }

    /**
     * Request a single permission from Electron via internal API
     */
    private async requestPermission(permission: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.realtimexUrl}/api/local-apps/request-permission`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    app_id: this.appId,
                    app_name: this.appName,
                    permission,
                }),
            });
            const data = await response.json();
            return data.granted === true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Make an API call with automatic permission handling
     */
    private async apiCall<T>(method: string, endpoint: string, options?: RequestInit): Promise<T> {
        const url = `${this.realtimexUrl}${endpoint}`;
        const response = await fetch(url, {
            method,
            headers: this.getHeaders(),
            ...options,
        });
        const data = await response.json();

        if (response.status === 403) {
            const errorCode = data.error;
            const permission = data.permission;
            const message = data.message;

            if (errorCode === 'PERMISSION_REQUIRED' && permission) {
                // Try to get permission from user
                const granted = await this.requestPermission(permission);

                if (granted) {
                    return this.apiCall<T>(method, endpoint, options);
                } else {
                    throw new PermissionDeniedError(permission, message);
                }
            }

            if (errorCode === 'PERMISSION_DENIED') {
                throw new PermissionDeniedError(permission, message);
            }

            throw new Error(data.error || 'Permission denied');
        }

        if (!response.ok) {
            throw new Error(data.error || `API call failed: ${response.status}`);
        }

        return data;
    }

    async getAgents(): Promise<Agent[]> {
        const data = await this.apiCall<{ agents: Agent[] }>('GET', '/agents');
        return data.agents;
    }

    async getWorkspaces(): Promise<Workspace[]> {
        const data = await this.apiCall<{ workspaces: Workspace[] }>('GET', '/workspaces');
        return data.workspaces;
    }

    async getThreads(workspaceSlug: string): Promise<Thread[]> {
        const data = await this.apiCall<{ threads: Thread[] }>('GET', `/workspaces/${encodeURIComponent(workspaceSlug)}/threads`);
        return data.threads;
    }

    async getTask(taskUuid: string): Promise<Task> {
        const data = await this.apiCall<{ task: Task; runs: Task['runs'] }>('GET', `/task/${encodeURIComponent(taskUuid)}`);
        return { ...data.task, runs: data.runs };
    }
}
