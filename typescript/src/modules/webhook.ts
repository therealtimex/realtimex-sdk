/**
 * Webhook Module - Call RealtimeX webhook
 */

import { TriggerAgentPayload, TriggerAgentResponse } from '../types';

export class WebhookModule {
    private realtimexUrl: string;
    private appName?: string;
    private appId?: string;

    constructor(realtimexUrl: string, appName?: string, appId?: string) {
        this.realtimexUrl = realtimexUrl.replace(/\/$/, '');
        this.appName = appName;
        this.appId = appId;
    }

    async triggerAgent(payload: TriggerAgentPayload): Promise<TriggerAgentResponse> {
        if (payload.auto_run && (!payload.agent_name || !payload.workspace_slug)) {
            throw new Error('auto_run requires agent_name and workspace_slug');
        }

        const response = await fetch(`${this.realtimexUrl}/webhooks/realtimex`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to trigger agent');
        return data as TriggerAgentResponse;
    }

    async ping(): Promise<{ success: boolean; app_name: string; message: string }> {
        const response = await fetch(`${this.realtimexUrl}/webhooks/realtimex`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_name: this.appName,
                app_id: this.appId,
                event: 'ping'
            }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ping failed');
        return data;
    }
}
