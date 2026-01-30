import { TTSOptions, TTSProvider, TTSProvidersResponse, TTSChunk, TTSChunkEvent } from '../types';
import { PermissionDeniedError } from './api';

export class TTSModule {
    private baseUrl: string;
    private appId: string;
    private appName: string;
    private apiKey?: string;

    constructor(realtimexUrl: string, appId: string, appName?: string, apiKey?: string) {
        this.baseUrl = realtimexUrl.replace(/\/$/, '');
        this.appId = appId;
        this.appName = appName || process.env.RTX_APP_NAME || 'Local App';
        this.apiKey = apiKey;
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
            console.error('[SDK] Permission request failed:', error);
            return false;
        }
    }

    /**
     * Internal request wrapper that handles automatic permission prompts
     */
    private async request<T>(method: string, endpoint: string, body?: any, isStream = false): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: this.headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const data = await response.json();

            if (data.code === 'PERMISSION_REQUIRED') {
                const permission = data.permission || 'tts.generate';
                const granted = await this.requestPermission(permission);
                if (granted) {
                    return this.request<T>(method, endpoint, body, isStream);
                }
                throw new PermissionDeniedError(permission);
            }

            throw new Error(data.error || `Request failed: ${response.status}`);
        }

        if (isStream) {
            return response.body as unknown as T;
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return response.json() as unknown as T;
        }

        return response.arrayBuffer() as unknown as T;
    }

    /**
     * Generate speech from text (returns full buffer)
     * 
     * @example
     * ```ts
     * const buffer = await sdk.tts.speak("Hello world");
     * // Play buffer...
     * ```
     */
    async speak(text: string, options: TTSOptions = {}): Promise<ArrayBuffer> {
        return this.request<ArrayBuffer>('POST', '/sdk/tts', {
            text,
            ...options
        });
    }

    /**
     * Generate speech from text with streaming (yields decoded audio chunks)
     * Uses SSE internally but returns decoded ArrayBuffer chunks for easy playback.
     * 
     * @example
     * ```ts
     * for await (const chunk of sdk.tts.speakStream("Hello world")) {
     *   // chunk.audio is ArrayBuffer (already decoded!)
     *   const blob = new Blob([chunk.audio], { type: chunk.mimeType });
     *   const audio = new Audio(URL.createObjectURL(blob));
     *   await audio.play();
     * }
     * ```
     */
    async *speakStream(text: string, options: TTSOptions = {}): AsyncGenerator<TTSChunk> {
        const response = await fetch(`${this.baseUrl}/sdk/tts/stream`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({ text, ...options }),
        });

        if (!response.ok) {
            const data = await response.json();

            if (data.code === 'PERMISSION_REQUIRED') {
                const permission = data.permission || 'tts.generate';
                const granted = await this.requestPermission(permission);
                if (granted) {
                    yield* this.speakStream(text, options);
                    return;
                }
                throw new PermissionDeniedError(permission);
            }

            throw new Error(data.error || `Streaming failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let eventType = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE events
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;

                    if (trimmedLine.startsWith('event:')) {
                        eventType = trimmedLine.slice(6).trim();
                    } else if (trimmedLine.startsWith('data:')) {
                        const eventData = trimmedLine.slice(5).trim();

                        if (eventType === 'chunk' && eventData) {
                            try {
                                const parsed = JSON.parse(eventData);
                                // Decode base64 to ArrayBuffer
                                const binaryString = atob(parsed.audio);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }

                                yield {
                                    index: parsed.index,
                                    total: parsed.total,
                                    audio: bytes.buffer,
                                    mimeType: parsed.mimeType,
                                };
                            } catch (e) {
                                console.warn('[TTS SDK] Failed to parse chunk:', e);
                            }
                        } else if (eventType === 'error' && eventData) {
                            try {
                                const err = JSON.parse(eventData);
                                throw new Error(err.error || 'TTS streaming error');
                            } catch (e) {
                                if (e instanceof Error && e.message !== 'TTS streaming error') {
                                    throw e;
                                }
                            }
                        }
                        // info and done events are handled silently

                        eventType = '';
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * List available TTS providers with configuration options
     */
    async listProviders(): Promise<TTSProvider[]> {
        const data = await this.request<TTSProvidersResponse>('GET', '/sdk/tts/providers');
        return data.providers || [];
    }
}
