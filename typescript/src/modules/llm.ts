/**
 * LLM Module for RealtimeX SDK
 * 
 * Provides access to LLM capabilities:
 * - Chat completion (sync and streaming)
 * - Embedding generation
 * - Provider/model listing
 * - Vector storage (upsert, query, delete)
 */

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
}

// === Errors ===

export class LLMPermissionError extends Error {
    constructor(
        public permission: string,
        public code: string = 'PERMISSION_REQUIRED'
    ) {
        super(`Permission required: ${permission}`);
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
        private apiKey?: string
    ) { }

    private get headers(): Record<string, string> {
        // Dev mode: use API key with Bearer auth
        if (this.apiKey) {
            return {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            };
        }
        // Production mode: use x-app-id
        return {
            'Content-Type': 'application/json',
            'x-app-id': this.appId,
        };
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
        const response = await fetch(`${this.baseUrl}/sdk/llm/vectors/upsert`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                vectors,
                workspaceId: options.workspaceId,
            }),
        });

        const data = await response.json();

        if (data.code === 'PERMISSION_REQUIRED') {
            throw new LLMPermissionError(data.permission || 'vectors.write');
        }

        return data;
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
        const response = await fetch(`${this.baseUrl}/sdk/llm/vectors/query`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                vector,
                topK: options.topK ?? 5,
                filter: options.filter,
                workspaceId: options.workspaceId,
            }),
        });

        const data = await response.json();

        if (data.code === 'PERMISSION_REQUIRED') {
            throw new LLMPermissionError(data.permission || 'vectors.read');
        }

        return data;
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
        const response = await fetch(`${this.baseUrl}/sdk/llm/vectors/delete`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(options),
        });

        const data = await response.json();

        if (data.code === 'PERMISSION_REQUIRED') {
            throw new LLMPermissionError(data.permission || 'vectors.write');
        }

        return data;
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
        const response = await fetch(`${this.baseUrl}/sdk/llm/vectors/workspaces`, {
            method: 'GET',
            headers: this.headers,
        });

        const data = await response.json();

        if (data.code === 'PERMISSION_REQUIRED') {
            throw new LLMPermissionError(data.permission || 'vectors.read');
        }

        return data;
    }
}

// === Main LLM Module ===

export class LLMModule {
    public vectors: VectorStore;

    constructor(
        private baseUrl: string,
        private appId: string,
        private apiKey?: string
    ) {
        this.vectors = new VectorStore(baseUrl, appId, apiKey);
    }

    private get headers(): Record<string, string> {
        // Dev mode: use API key with Bearer auth
        if (this.apiKey) {
            return {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            };
        }
        // Production mode: use x-app-id
        return {
            'Content-Type': 'application/json',
            'x-app-id': this.appId,
        };
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
        const response = await fetch(`${this.baseUrl}/sdk/llm/providers/chat`, {
            method: 'GET',
            headers: this.headers,
        });

        const data = await response.json();

        if (data.code === 'PERMISSION_REQUIRED') {
            throw new LLMPermissionError(data.permission || 'llm.providers');
        }

        return data;
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
        const response = await fetch(`${this.baseUrl}/sdk/llm/providers/embed`, {
            method: 'GET',
            headers: this.headers,
        });

        const data = await response.json();

        if (data.code === 'PERMISSION_REQUIRED') {
            throw new LLMPermissionError(data.permission || 'llm.providers');
        }

        return data;
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
        const response = await fetch(`${this.baseUrl}/sdk/llm/chat`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                messages,
                model: options.model,
                provider: options.provider,
                temperature: options.temperature ?? 0.7,
                max_tokens: options.max_tokens ?? 1000,
            }),
        });

        const data = await response.json();

        if (data.code === 'PERMISSION_REQUIRED') {
            throw new LLMPermissionError(data.permission || 'llm.chat');
        }

        if (data.code === 'LLM_ERROR') {
            throw new LLMProviderError(data.error || 'LLM request failed');
        }

        return data;
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
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (errorData.code === 'PERMISSION_REQUIRED') {
                throw new LLMPermissionError(errorData.permission || 'llm.chat');
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

        const response = await fetch(`${this.baseUrl}/sdk/llm/embed`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                input: inputArray,
                provider: options.provider,
                model: options.model,
            }),
        });

        const data = await response.json();

        if (data.code === 'PERMISSION_REQUIRED') {
            throw new LLMPermissionError(data.permission || 'llm.embed');
        }

        if (data.code === 'PROVIDER_UNAVAILABLE') {
            throw new LLMProviderError(data.error || 'Embedding provider not available');
        }

        return data;
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
