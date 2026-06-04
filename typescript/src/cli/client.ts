import {
    AuthenticationError,
    DeveloperApiError,
    NotFoundError,
    ServerError,
    ValidationError,
} from '../v1/errors';

export class CliApiClient {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly appId?: string;

    constructor(baseUrl: string, apiKey: string, appId?: string) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.apiKey = apiKey;
        this.appId = appId;
    }

    private getHeaders(extra?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
        };
        if (this.appId) headers['x-app-id'] = this.appId;
        return { ...headers, ...extra };
    }

    private async handleResponse<T>(response: Response): Promise<T> {
        let data: any;
        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (response.ok) return data as T;

        const message = data?.message || data?.error || response.statusText || 'Request failed';

        switch (response.status) {
            case 400: throw new ValidationError(message);
            case 401:
            case 403: throw new AuthenticationError(message);
            case 404: throw new NotFoundError(message);
            case 500:
            case 502:
            case 503: throw new ServerError(message);
            default: throw new DeveloperApiError(response.status, 'API_ERROR', message);
        }
    }

    async request<T = unknown>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<T> {
        const url = `${this.baseUrl}/cli${path}`;
        const response = await fetch(url, {
            method,
            headers: this.getHeaders(),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        return this.handleResponse<T>(response);
    }
}
