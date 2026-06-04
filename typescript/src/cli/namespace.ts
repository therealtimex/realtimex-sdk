import { CliApiClient } from './client';

export interface NameRequest {
    name: string;
}

export interface CreateThreadRequest {
    name?: string;
}

export interface WorkspaceDefaultAgentRequest {
    canonical: string;
    providerId?: string;
    modelId?: string;
}

export interface SendLlmMessageRequest {
    message: string;
    chatProvider: string;
    chatModel: string;
    attachments?: Record<string, unknown>[];
    webSearchEnabled?: boolean;
    thinkingEffort?: string;
    chatTuningConfig?: Record<string, unknown>;
    [key: string]: unknown;
}

export class CliApiNamespace {
    /** @internal Shared HTTP client used by all CLI API methods */
    readonly _client: CliApiClient;

    constructor(baseUrl: string, apiKey: string, appId?: string) {
        this._client = new CliApiClient(baseUrl, apiKey, appId);
    }

    async prepare(): Promise<unknown> {
        return this._client.request('GET', '/prepare');
    }

    async listWorkspaces(): Promise<unknown> {
        return this._client.request('GET', '/list-workspaces');
    }

    async createWorkspace(body: NameRequest): Promise<unknown> {
        return this._client.request('POST', '/create-workspace', body);
    }

    async getWorkspace(workspaceSlug: string): Promise<unknown> {
        return this._client.request('GET', `/get-workspace/${encodeURIComponent(workspaceSlug)}`);
    }

    async renameWorkspace(workspaceSlug: string, body: NameRequest): Promise<unknown> {
        return this._client.request('POST', `/rename-workspace/${encodeURIComponent(workspaceSlug)}`, body);
    }

    async deleteWorkspace(workspaceSlug: string): Promise<unknown> {
        return this._client.request('DELETE', `/delete-workspace/${encodeURIComponent(workspaceSlug)}`);
    }

    async setWorkspaceDefaultAgent(workspaceSlug: string, body: WorkspaceDefaultAgentRequest): Promise<unknown> {
        return this._client.request('POST', `/set-workspace-default-agent/${encodeURIComponent(workspaceSlug)}`, body);
    }

    async clearWorkspaceDefaultAgent(workspaceSlug: string): Promise<unknown> {
        return this._client.request('DELETE', `/clear-workspace-default-agent/${encodeURIComponent(workspaceSlug)}`);
    }

    async listThreads(workspaceSlug: string): Promise<unknown> {
        return this._client.request('GET', `/list-threads/${encodeURIComponent(workspaceSlug)}`);
    }

    async createThread(workspaceSlug: string, body?: CreateThreadRequest): Promise<unknown> {
        return this._client.request('POST', `/create-thread/${encodeURIComponent(workspaceSlug)}`, body);
    }

    async getThread(workspaceSlug: string, threadSlug: string): Promise<unknown> {
        return this._client.request(
            'GET',
            `/get-thread/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(threadSlug)}`
        );
    }

    async renameThread(workspaceSlug: string, threadSlug: string, body: NameRequest): Promise<unknown> {
        return this._client.request(
            'POST',
            `/rename-thread/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(threadSlug)}`,
            body
        );
    }

    async deleteThread(workspaceSlug: string, threadSlug: string): Promise<unknown> {
        return this._client.request(
            'DELETE',
            `/delete-thread/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(threadSlug)}`
        );
    }

    async sendLlmMessage(workspaceSlug: string, threadSlug: string, body: SendLlmMessageRequest): Promise<unknown> {
        return this._client.request(
            'POST',
            `/send-llm-message/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(threadSlug)}`,
            body
        );
    }

    async listLlmProviders(): Promise<unknown> {
        return this._client.request('GET', '/list-llm-providers');
    }

    async listLlmModels(provider: string): Promise<unknown> {
        return this._client.request('GET', `/list-llm-models/${encodeURIComponent(provider)}`);
    }
}
