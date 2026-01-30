/**
 * LLM Module for RealtimeX SDK
 * 
 * Provides access to LLM capabilities:
 * - Chat completion (sync and streaming)
 * - Embedding generation
 * - Provider/model listing
 * - Vector storage (upsert, query, delete)
 */

import { PermissionDeniedError, PermissionRequiredError } from './api';

// === Types ===

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ChatOptions {
    model?: string;
    provider?: string;
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: string };  // For JSON mode: { type: "json_object" }
}

export interface ChatResponse {
    success: boolean;
    response?: {
        content: string;
        model: string;
        provider?: string;
        metrics?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
            duration?: number;
            outputTps?: number;
        };
    };
    error?: string;
    code?: string;
}

export interface StreamChunk {
    uuid?: string;
    type?: string;
    textResponse?: string;
    close?: boolean;
    error?: boolean;
}

export interface EmbedOptions {
    provider?: string;
    model?: string;
}

export interface EmbedResponse {
    success: boolean;
    embeddings?: number[][];
    provider?: string;
    model?: string;
    dimensions?: number;
    error?: string;
    code?: string;
    errors?: string[];
}

export interface Provider {
    provider: string;
    models: Array<{ id: string; name: string }>;
}

export interface ProvidersResponse {
    success: boolean;
    llm?: Provider[];
    embedding?: Provider[];
    providers?: Provider[]; // For specialized endpoints
    error?: string;
    code?: string;
}


// Vector Store Types
export interface VectorRecord {
    id: string;
    vector: number[];
    metadata?: {
        text?: string;
        documentId?: string;
        workspaceId?: string;
        [key: string]: unknown;
    };
}

export interface VectorUpsertOptions {
    workspaceId?: string;
}

export interface VectorUpsertResponse {
    success: boolean;
    upserted?: number;
    namespace?: string;
    error?: string;
    code?: string;
    errors?: string[];
}

export interface VectorQueryOptions {
    topK?: number;
    filter?: {
        workspaceId?: string;
        documentId?: string;
    };
    workspaceId?: string;
    provider?: string;
    model?: string;
}

export interface VectorQueryResult {
    id: string;
    score: number;
    metadata?: {
        text?: string;
        documentId?: string;
        workspaceId?: string;
        [key: string]: unknown;
    };
}

export interface VectorQueryResponse {
    success: boolean;
    results?: VectorQueryResult[];
    error?: string;
    code?: string;
}

export interface VectorDeleteOptions {
    workspaceId?: string;
    deleteAll: true;
}

export interface VectorDeleteResponse {
    success: boolean;
    deleted?: number;
    message?: string;
    error?: string;
    code?: string;
    errors?: string[];
}

export interface VectorListWorkspacesResponse {
    success: boolean;
    workspaces?: string[];
    error?: string;
    code?: string;
    error_message?: string;
}

export interface VectorRegisterResponse {
    success: boolean;
    message?: string;
    error?: string;
    code?: string;
}

export interface VectorConfigResponse {
    success: boolean;
    provider?: string;
    config?: Record<string, any>;
    error?: string;
    code?: string;
}

export interface VectorProviderField {
    name: string;
    label: string;
    type: 'string' | 'password';
    placeholder?: string;
}

export interface VectorProviderMetadata {
    name: string;
    label: string;
    description?: string;
    fields: VectorProviderField[];
}

export interface VectorProvidersResponse {
    success: boolean;
    providers: VectorProviderMetadata[];
}

// === Errors ===

/**
 * @deprecated Use PermissionRequiredError from api module instead
 */
export class LLMPermissionError extends PermissionRequiredError {
    constructor(permission: string, code: string = 'PERMISSION_REQUIRED') {
        super(permission, undefined, code);
        this.name = 'LLMPermissionError';
    }
}

export class LLMProviderError extends Error {
    constructor(
        message: string,
        public code: string = 'LLM_ERROR'
    ) {
        super(message);
        this.name = 'LLMProviderError';
    }
}

// === Vector Store Sub-module ===

export class VectorStore {
    constructor(
        private baseUrl: string,
        private appId: string,
        private appName: string = 'Local App',
        private apiKey?: string
    ) { }

    private get headers(): Record<string, string> {
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
            const response = await fetch(`${this.baseUrl}/api/local-apps/request-permission`, {
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
     * Internal request wrapper that handles automatic permission prompts
     */
    private async request<T>(method: string, endpoint: string, body?: any): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: this.headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        const data = await response.json();

        if (data.code === 'PERMISSION_REQUIRED') {
            const permission = data.permission || 'vectors.read';
            const granted = await this.requestPermission(permission);
            if (granted) {
                return this.request<T>(method, endpoint, body);
            }
            throw new PermissionDeniedError(permission);
        }

        if (!data.success && data.error) {
            if (data.code === 'LLM_ERROR') {
                throw new LLMProviderError(data.error);
            }
            throw new Error(data.error);
        }

        return data;
    }

    /**
     * Upsert (insert or update) vectors into storage
     * 
     * @example
     * ```ts
     * await sdk.llm.vectors.upsert([
     *   { id: 'chunk-1', vector: embeddings[0], metadata: { text: 'Hello', documentId: 'doc-1' } }
     * ], { workspaceId: 'ws-123' });
     * ```
     */
    async upsert(vectors: VectorRecord[], options: VectorUpsertOptions = {}): Promise<VectorUpsertResponse> {
        return this.request<VectorUpsertResponse>('POST', '/sdk/llm/vectors/upsert', {
            vectors,
            workspaceId: options.workspaceId,
        });
    }

    /**
     * Query similar vectors by embedding
     * 
     * @example
     * ```ts
     * const results = await sdk.llm.vectors.query(queryVector, {
     *   topK: 5,
     *   filter: { documentId: 'doc-1' },
     *   workspaceId: 'ws-123'
     * });
     * ```
     */
    async query(vector: number[], options: VectorQueryOptions = {}): Promise<VectorQueryResponse> {
        return this.request<VectorQueryResponse>('POST', '/sdk/llm/vectors/query', {
            vector,
            topK: options.topK ?? 5,
            filter: options.filter,
            workspaceId: options.workspaceId,
        });
    }

    /**
     * Delete vectors from storage
     * 
     * Note: Currently only supports deleteAll: true
     * Use workspaceId to scope deletion to a specific workspace
     * 
     * @example
     * ```ts
     * await sdk.llm.vectors.delete({ deleteAll: true, workspaceId: 'ws-123' });
     * ```
     */
    async delete(options: VectorDeleteOptions): Promise<VectorDeleteResponse> {
        return this.request<VectorDeleteResponse>('POST', '/sdk/llm/vectors/delete', options);
    }

    /**
     * List all available workspaces (namespaces) for this app
     * 
     * @example
     * ```ts
     * const { workspaces } = await sdk.llm.vectors.listWorkspaces();
     * console.log('Workspaces:', workspaces);
     * ```
     */
    async listWorkspaces(): Promise<VectorListWorkspacesResponse> {
        return this.request<VectorListWorkspacesResponse>('GET', '/sdk/llm/vectors/workspaces');
    }

    /**
     * Register a custom vector database configuration for this app
     * 
     * @example
     * ```ts
     * await sdk.llm.vectors.registerConfig('lancedb', { });
     * ```
     */
    async registerConfig(provider: string, config: Record<string, any>): Promise<VectorRegisterResponse> {
        return this.request<VectorRegisterResponse>('POST', '/sdk/llm/vectors/register', {
            provider,
            config,
        });
    }

    /**
     * List all supported vector database providers and their configuration requirements
     */
    async listProviders(): Promise<VectorProvidersResponse> {
        return this.request<VectorProvidersResponse>('GET', '/sdk/llm/vectors/providers');
    }

    /**
     * Get the current vector database configuration for this app
     * 
     * @example
     * ```ts
     * const { provider, config } = await sdk.llm.vectors.getConfig();
     * console.log(`App is using ${provider}`);
     * ```
     */
    async getConfig(): Promise<VectorConfigResponse> {
        return this.request<VectorConfigResponse>('GET', '/sdk/llm/vectors/config');
    }
}

// === Main LLM Module ===

export class LLMModule {
    public vectors: VectorStore;

    constructor(
        private baseUrl: string,
        private appId: string,
        private appName: string = 'Local App',
        private apiKey?: string
    ) {
        this.vectors = new VectorStore(baseUrl, appId, appName, apiKey);
    }

    private get headers(): Record<string, string> {
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
            const response = await fetch(`${this.baseUrl}/api/local-apps/request-permission`, {
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
     * Internal request wrapper that handles automatic permission prompts
     */
    private async request<T>(method: string, endpoint: string, body?: any): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: this.headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        const data = await response.json();

        if (data.code === 'PERMISSION_REQUIRED') {
            const permission = data.permission || 'llm.chat';
            const granted = await this.requestPermission(permission);
            if (granted) {
                return this.request<T>(method, endpoint, body);
            }
            throw new PermissionDeniedError(permission);
        }

        if (!data.success && data.error) {
            if (data.code === 'LLM_ERROR') {
                throw new LLMProviderError(data.error);
            }
            throw new Error(data.error);
        }

        return data;
    }



    /**
     * Get only configured chat (LLM) providers
     * 
     * @example
     * ```ts
     * const { providers } = await sdk.llm.chatProviders();
     * console.log('Available chat models:', providers[0].models);
     * ```
     */
    async chatProviders(): Promise<ProvidersResponse> {
        return this.request<ProvidersResponse>('GET', '/sdk/llm/providers/chat');
    }

    /**
     * Get only configured embedding providers
     * 
     * @example
     * ```ts
     * const { providers } = await sdk.llm.embedProviders();
     * console.log('Available embedding models:', providers[0].models);
     * ```
     */
    async embedProviders(): Promise<ProvidersResponse> {
        return this.request<ProvidersResponse>('GET', '/sdk/llm/providers/embed');
    }


    /**
     * Send a chat completion request (synchronous)
     * 
     * @example
     * ```ts
     * const response = await sdk.llm.chat([
     *   { role: 'system', content: 'You are a helpful assistant.' },
     *   { role: 'user', content: 'Hello!' }
     * ], { model: 'gpt-4o', temperature: 0.7 });
     * 
     * console.log(response.response?.content);
     * ```
     */
    async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
        return this.request<ChatResponse>('POST', '/sdk/llm/chat', {
            messages,
            model: options.model,
            provider: options.provider,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens ?? 1000,
            response_format: options.response_format,
        });
    }

    /**
     * Send a streaming chat completion request (SSE)
     * 
     * @example
     * ```ts
     * for await (const chunk of sdk.llm.chatStream([
     *   { role: 'user', content: 'Tell me a story' }
     * ])) {
     *   process.stdout.write(chunk.textResponse || '');
     * }
     * ```
     */
    async *chatStream(
        messages: ChatMessage[],
        options: ChatOptions = {}
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const response = await fetch(`${this.baseUrl}/sdk/llm/chat/stream`, {
            method: 'POST',
            headers: {
                ...this.headers,
                'Accept': 'text/event-stream',
            },
            body: JSON.stringify({
                messages,
                model: options.model,
                provider: options.provider,
                temperature: options.temperature ?? 0.7,
                max_tokens: options.max_tokens ?? 1000,
                response_format: options.response_format,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (errorData.code === 'PERMISSION_REQUIRED') {
                const permission = errorData.permission || 'llm.chat';
                const granted = await this.requestPermission(permission);
                if (granted) {
                    yield* this.chatStream(messages, options);
                    return;
                }
                throw new PermissionDeniedError(permission);
            }
            throw new LLMProviderError(errorData.error || 'Stream request failed');
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new LLMProviderError('Response body is not readable');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let isErrorEvent = false;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    // Skip empty lines and comments
                    if (!trimmedLine || trimmedLine.startsWith(':')) continue;

                    // Handle SSE event format
                    if (trimmedLine.startsWith('event: error')) {
                        isErrorEvent = true;
                        continue;
                    }

                    if (trimmedLine.startsWith('data: ')) {
                        const jsonStr = trimmedLine.slice(6);
                        if (jsonStr === '[DONE]') {
                            isErrorEvent = false;
                            continue;
                        }

                        try {
                            const data = JSON.parse(jsonStr);

                            if (isErrorEvent) {
                                isErrorEvent = false;
                                throw new LLMProviderError(
                                    data.error || 'Stream error',
                                    data.code || 'LLM_STREAM_ERROR'
                                );
                            }

                            const chunk: StreamChunk = data;

                            // Check for error field in chunk (backward compatibility)
                            if (chunk.error) {
                                throw new LLMProviderError(
                                    (chunk as any).message || 'Stream error'
                                );
                            }

                            yield chunk;
                        } catch (parseError) {
                            isErrorEvent = false;
                            // Skip non-JSON lines
                            if (jsonStr !== '[DONE]') {
                                console.warn('[LLM Stream] Parse error:', jsonStr);
                            }
                            if (parseError instanceof LLMProviderError) throw parseError;
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Generate vector embeddings from text
     * 
     * @example
     * ```ts
     * // Single text
     * const { embeddings } = await sdk.llm.embed('Hello world');
     * 
     * // Multiple texts
     * const { embeddings } = await sdk.llm.embed(['Hello', 'World']);
     * ```
     */
    async embed(input: string | string[], options: EmbedOptions = {}): Promise<EmbedResponse> {
        const inputArray = Array.isArray(input) ? input : [input];

        return this.request<EmbedResponse>('POST', '/sdk/llm/embed', {
            input: inputArray,
            provider: options.provider,
            model: options.model,
        });
    }

    /**
     * Helper: Embed text and store as vectors in one call
     * 
     * @example
     * ```ts
     * await sdk.llm.embedAndStore({
     *   texts: ['Hello world', 'Goodbye world'],
     *   documentId: 'doc-123',
     *   workspaceId: 'ws-456'
     * });
     * ```
     */
    async embedAndStore(params: {
        texts: string[];
        documentId?: string;
        workspaceId?: string;
        idPrefix?: string;
        provider?: string;
        model?: string;
    }): Promise<VectorUpsertResponse> {
        const { texts, documentId, workspaceId, idPrefix = 'chunk', provider, model } = params;

        // Generate embeddings
        const embedResult = await this.embed(texts, { provider, model });
        if (!embedResult.success || !embedResult.embeddings) {
            return {
                success: false,
                error: embedResult.error || 'Embedding failed',
                code: embedResult.code,
            };
        }

        // Generate a unique ID base if using default to avoid collisions across successive calls
        let uniquePrefix = idPrefix;
        if (idPrefix === 'chunk') {
            const randomSuffix = Math.random().toString(36).substring(2, 6);
            uniquePrefix = `chunk_${randomSuffix}`;
        }

        // Create vector records
        const vectors: VectorRecord[] = texts.map((text, i) => ({
            id: `${uniquePrefix}_${i}`,
            vector: embedResult.embeddings![i],
            metadata: {
                text,
                documentId,
                workspaceId,
                embeddingModel: embedResult.model || model || 'unknown',
            },
        }));

        // Store vectors
        return this.vectors.upsert(vectors, { workspaceId });
    }

    /**
     * Helper: Search similar documents by text query
     * 
     * @example
     * ```ts
     * const results = await sdk.llm.search('What is RealtimeX?', {
     *   topK: 5,
     *   workspaceId: 'ws-123'
     * });
     * 
     * for (const result of results) {
     *   console.log(result.metadata?.text, result.score);
     * }
     * ```
     */
    async search(query: string, options: VectorQueryOptions = {}): Promise<VectorQueryResult[]> {
        // Embed query
        const embedResult = await this.embed(query, {
            provider: options.provider,
            model: options.model
        });
        if (!embedResult.success || !embedResult.embeddings?.[0]) {
            throw new LLMProviderError('Failed to embed query');
        }

        // Search vectors
        const queryResult = await this.vectors.query(embedResult.embeddings[0], {
            ...options,
            model: options.model || embedResult.model
        });
        if (!queryResult.success) {
            throw new LLMProviderError(queryResult.error || 'Vector search failed');
        }

        return queryResult.results || [];
    }
}
