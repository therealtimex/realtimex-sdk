import { RuntimeTransportError } from '../errors/ContractErrors';

export interface ContractHttpClientConfig {
    baseUrl: string;
    appId?: string;
    appName?: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
}

function toRecordHeaders(input: HeadersInit = {}): Record<string, string> {
    if (input instanceof Headers) {
        const normalized: Record<string, string> = {};
        input.forEach((value, key) => {
            normalized[key] = value;
        });
        return normalized;
    }

    if (Array.isArray(input)) {
        return Object.fromEntries(input);
    }

    return { ...(input as Record<string, string>) };
}

export class ContractHttpClient {
    private readonly baseUrl: string;
    private readonly appId?: string;
    private readonly appName?: string;
    private readonly apiKey?: string;
    private readonly fetchImpl: typeof fetch;

    constructor(config: ContractHttpClientConfig) {
        this.baseUrl = config.baseUrl.replace(/\/$/, '');
        this.appId = config.appId;
        this.appName = config.appName;
        this.apiKey = config.apiKey;
        this.fetchImpl = config.fetchImpl || fetch;
    }

    public async get<T>(path: string, headers: HeadersInit = {}): Promise<T> {
        return this.request<T>(path, {
            method: 'GET',
            headers,
        });
    }

    public async post<T>(path: string, body: unknown, headers: HeadersInit = {}): Promise<T> {
        return this.request<T>(path, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
    }

    public async request<T>(path: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        const headers = this.buildHeaders(options.headers);

        let response: Response;
        try {
            response = await this.fetchImpl(url, {
                ...options,
                headers,
            });
        } catch (error) {
            throw new RuntimeTransportError('Failed to reach RealtimeX server', undefined, {
                cause: error,
                url,
            });
        }

        const payload = await this.parseResponse(response);

        if (!response.ok) {
            const errorMessage =
                (payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: unknown }).error === 'string'
                    ? (payload as { error: string }).error
                    : `Request failed with status ${response.status}`);

            throw new RuntimeTransportError(errorMessage, response.status, payload);
        }

        return payload as T;
    }

    private buildHeaders(extraHeaders: HeadersInit = {}): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...toRecordHeaders(extraHeaders),
        };

        if (this.apiKey) {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }

        if (this.appId) {
            headers['x-app-id'] = this.appId;
        }

        if (this.appName) {
            headers['x-app-name'] = this.appName;
        }

        return headers;
    }

    private async parseResponse(response: Response): Promise<unknown> {
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            try {
                return await response.json();
            } catch {
                return {};
            }
        }

        const text = await response.text();
        if (!text) return {};

        try {
            return JSON.parse(text);
        } catch {
            return { text };
        }
    }
}
