import { TTSOptions, TTSProvider, TTSProvidersResponse } from '../types';
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
        if (this.apiKey) {
            return {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            };
        }
        return {
            'Content-Type': 'application/json',
            'x-app-id': this.appId,
        };
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
                const permission = data.permission || 'tts.speak';
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
     * Generate speech from text (returns stream)
     * 
     * @example
     * ```ts
     * const stream = await sdk.tts.speakStream("Hello world");
     * for await (const chunk of stream) {
     *   // Play chunk...
     * }
     * ```
     */
    async *speakStream(text: string, options: TTSOptions = {}): AsyncGenerator<Uint8Array> {
        const body = await this.request<ReadableStream>('POST', '/sdk/tts/stream', {
            text,
            ...options
        }, true);

        if (!body) throw new Error('No response body');

        const reader = body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                yield value;
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * List available TTS providers
     */
    async listProviders(): Promise<TTSProvider[]> {
        const data = await this.request<TTSProvidersResponse>('GET', '/sdk/tts/providers');
        return data.providers || [];
    }
}
