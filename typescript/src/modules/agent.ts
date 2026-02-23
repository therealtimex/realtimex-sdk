/**
 * Agent Module - Simple session-based agent chat
 *
 * This module provides the simplest way to chat with AI agents:
 * 1. Create a session (optional - can just chat directly)
 * 2. Send messages (context is automatically maintained)
 * 3. Close session when done (optional - auto-expires)
 */

import { HttpClient } from './http';

export interface AgentSessionOptions {
    workspace_slug?: string;  // Optional - auto-selects first workspace
    thread_slug?: string;     // Optional - for contextual conversation
    agent_name?: string;      // Optional - default: '@agent'
}

export interface AgentSession {
    session_id: string;
    workspace: {
        slug: string;
        name: string;
    };
    thread?: {
        slug: string;
        name: string;
    } | null;
    agent: {
        name: string;
        provider: string;
        model: string | null;
    };
    created_at: string;
}

export interface AgentChatOptions {
    message: string;
}

export interface AgentChatResponse {
    id: string;
    session_id: string;
    text: string;
    thoughts: string[];
    message_count: number;
}

export interface AgentSessionInfo extends AgentSession {
    message_count: number;
    last_message_at: string | null;
}

export interface StreamChunkEvent {
    type: 'agentThought' | 'textResponse' | 'close' | 'error';
    data: any;
}

export class AgentModule {
    private httpClient: HttpClient;

    constructor(httpClient: HttpClient) {
        this.httpClient = httpClient;
    }

    /**
     * Create a new agent session
     *
     * @example
     * ```typescript
     * const session = await sdk.agent.createSession({
     *   workspace_slug: 'my-workspace',
     *   agent_name: '@agent'
     * });
     * ```
     */
    async createSession(options?: AgentSessionOptions): Promise<AgentSession> {
        const response = await this.httpClient.fetch('/sdk/agent/session', {
            method: 'POST',
            body: JSON.stringify(options || {})
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to create session');
        }

        return data.session;
    }

    /**
     * Chat within a session (synchronous)
     *
     * @example
     * ```typescript
     * const response = await sdk.agent.chat(sessionId, 'Hello agent!');
     * console.log(response.text);
     * ```
     */
    async chat(sessionId: string, message: string): Promise<AgentChatResponse> {
        const response = await this.httpClient.fetch(`/sdk/agent/session/${sessionId}/chat`, {
            method: 'POST',
            body: JSON.stringify({ message })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Chat request failed');
        }

        return data.response;
    }

    /**
     * Stream chat within a session
     * Returns an async iterator for SSE events
     *
     * @example
     * ```typescript
     * for await (const event of sdk.agent.streamChat(sessionId, 'Tell me a story')) {
     *   if (event.type === 'agentThought') {
     *     console.log('Thinking:', event.data.thought);
     *   } else if (event.type === 'textResponse') {
     *     console.log('Response:', event.data.textResponse);
     *   }
     * }
     * ```
     */
    async *streamChat(sessionId: string, message: string): AsyncIterableIterator<StreamChunkEvent> {
        const response = await this.httpClient.fetch(`/sdk/agent/session/${sessionId}/chat/stream`, {
            method: 'POST',
            body: JSON.stringify({ message })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Stream request failed');
        }

        if (!response.body) {
            throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6));
                        yield {
                            type: data.type,
                            data
                        };
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Get session information
     *
     * @example
     * ```typescript
     * const info = await sdk.agent.getSession(sessionId);
     * console.log(`Messages sent: ${info.message_count}`);
     * ```
     */
    async getSession(sessionId: string): Promise<AgentSessionInfo> {
        const response = await this.httpClient.fetch(`/sdk/agent/session/${sessionId}`, {
            method: 'GET'
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to get session info');
        }

        return data.session;
    }

    /**
     * Close and delete a session
     * Sessions auto-expire after 1 hour, but you can close them manually
     *
     * @example
     * ```typescript
     * await sdk.agent.closeSession(sessionId);
     * ```
     */
    async closeSession(sessionId: string): Promise<void> {
        const response = await this.httpClient.fetch(`/sdk/agent/session/${sessionId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to close session');
        }
    }

    /**
     * Helper: Create session and send first message in one call
     * This is the simplest way to start chatting with an agent
     *
     * @example
     * ```typescript
     * const { session, response } = await sdk.agent.startChat('Hello agent!');
     * console.log(response.text);
     *
     * // Continue chatting in the same session
     * const reply = await sdk.agent.chat(session.session_id, 'Tell me more');
     * ```
     */
    async startChat(
        message: string,
        options?: AgentSessionOptions
    ): Promise<{ session: AgentSession; response: AgentChatResponse }> {
        const session = await this.createSession(options);
        const response = await this.chat(session.session_id, message);
        return { session, response };
    }
}
