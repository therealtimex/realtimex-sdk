// @manual-override — this file is never overwritten by generate-v1-sdk.mjs
// SSE streaming implementation for workspace chat.
// The generated stub in modules/v1Workspace.ts returns a raw Response;
// use streamChat() from this module for a typed AsyncGenerator instead.

import { DeveloperApiClient } from '../client';

export interface WorkspaceStreamChunk {
    /** The text fragment emitted by this SSE event */
    textResponse: string;
    /** Unique identifier for this chat session */
    id: string;
    /** Human-readable source references used for this response, if any */
    sources: Array<{ id: string; url?: string; title?: string; score?: number }>;
    /** Whether this is the final chunk in the stream */
    close: boolean;
    /** Error message, present only when the server emits an error event */
    error: string | null;
}

/**
 * Execute a streamable chat with a workspace and yield typed SSE chunks.
 *
 * @example
 * ```ts
 * const sdk = new RealtimeXSDK({ realtimex: { apiKey: 'sk-...' } });
 * for await (const chunk of streamWorkspaceChat(sdk.v1!._client, 'my-workspace', { message: 'Hello' })) {
 *   process.stdout.write(chunk.textResponse);
 * }
 * ```
 */
export async function* streamWorkspaceChat(
    client: DeveloperApiClient,
    slug: string,
    body?: Record<string, unknown>,
): AsyncGenerator<WorkspaceStreamChunk, void, unknown> {
    const response = await client.requestRaw('POST', `/v1/workspace/${slug}/stream-chat`, body);

    if (!response.body) {
        throw new Error('Response body is null — streaming is not supported in this environment');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let isErrorEvent = false;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                if (line.startsWith('event: error')) {
                    isErrorEvent = true;
                    continue;
                }
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === '[DONE]') {
                        isErrorEvent = false;
                        continue;
                    }
                    let data: WorkspaceStreamChunk;
                    try {
                        data = JSON.parse(jsonStr) as WorkspaceStreamChunk;
                    } catch {
                        continue;
                    }
                    if (isErrorEvent) {
                        throw new Error(data.error ?? 'Unknown streaming error from server');
                    }
                    yield data;
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}
