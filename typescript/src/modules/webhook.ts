import { TriggerAgentPayload, TriggerAgentResponse } from '../types';
import { PermissionDeniedError } from './api';

export class WebhookModule {
    private realtimexUrl: string;
    private appName?: string;
    private appId?: string;
    private apiKey?: string;

    constructor(realtimexUrl: string, appName?: string, appId?: string, apiKey?: string) {
        this.realtimexUrl = realtimexUrl.replace(/\/$/, '');
        this.appName = appName;
        this.appId = appId;
        this.apiKey = apiKey;
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
            console.error('[SDK] Permission request failed:', error);
            return false;
        }
    }

    private async request<T>(
        path: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${this.realtimexUrl}${path}`;
        const headers: any = {
            'Content-Type': 'application/json',
            ...(options.headers as any),
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        if (this.appId) {
            headers['x-app-id'] = this.appId;
        }

        const response = await fetch(url, {
            ...options,
            headers,
        });

        const data = await response.json();

        // Handle permission errors
        if (response.status === 403) {
            const errorCode = data.error;
            const permission = data.permission;
            const message = data.message;

            if (errorCode === 'PERMISSION_REQUIRED' && permission) {
                // Try to get permission from user
                const granted = await this.requestPermission(permission);

                if (granted) {
                    // Retry the original request
                    return this.request<T>(path, options);
                } else {
                    throw new PermissionDeniedError(permission, message);
                }
            }

            if (errorCode === 'PERMISSION_DENIED') {
                throw new PermissionDeniedError(permission, message);
            }
        }

        if (!response.ok) {
            throw new Error(data.error || `Request failed: ${response.status}`);
        }
        return data;
    }

    async triggerAgent(payload: TriggerAgentPayload): Promise<TriggerAgentResponse> {
        if (payload.auto_run && (!payload.agent_name || !payload.workspace_slug)) {
            throw new Error('auto_run requires agent_name and workspace_slug');
        }

        return this.request<TriggerAgentResponse>('/webhooks/realtimex', {
            method: 'POST',
            body: JSON.stringify({
                app_name: this.appName,
                app_id: this.appId,
                event: 'trigger-agent',
                payload: {
                    raw_data: payload.raw_data,
                    auto_run: payload.auto_run ?? false,
                    agent_name: payload.agent_name,
                    workspace_slug: payload.workspace_slug,
                    thread_slug: payload.thread_slug,
                    prompt: payload.prompt ?? '',
                },
            }),
        });
    }

    async ping(): Promise<{ success: boolean; app_name: string; message: string }> {
        return this.request<{ success: boolean; app_name: string; message: string }>('/webhooks/realtimex', {
            method: 'POST',
            body: JSON.stringify({
                app_name: this.appName,
                app_id: this.appId,
                event: 'ping'
            }),
        });
    }
}
