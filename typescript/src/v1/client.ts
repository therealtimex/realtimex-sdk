/**
 * DeveloperApiClient - HTTP client for the RealtimeX v1 Developer API.
 *
 * Uses API Key authentication only (Authorization: Bearer <apiKey>).
 * No x-app-id header, no token refresh — this is the server-to-server client.
 */

import {
    DeveloperApiError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
    ServerError,
} from './errors';

export class DeveloperApiClient {
    private readonly baseUrl: string;
    private readonly apiKey: string;

    constructor(baseUrl: string, apiKey: string) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.apiKey = apiKey;
    }

    private getHeaders(extra?: Record<string, string>): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            ...extra,
        };
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
            default:  throw new DeveloperApiError(response.status, 'API_ERROR', message);
        }
    }

    /**
     * Make a JSON request to the v1 API.
     */
    async request<T = unknown>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<T> {
        const url = `${this.baseUrl}/api${path}`;
        const response = await fetch(url, {
            method,
            headers: this.getHeaders(),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        return this.handleResponse<T>(response);
    }

    /**
     * Make a multipart/form-data request (e.g. file uploads).
     * Do NOT set Content-Type — browser/fetch will set it with the boundary.
     */
    async requestMultipart<T = unknown>(
        method: string,
        path: string,
        form: FormData
    ): Promise<T> {
        const url = `${this.baseUrl}/api${path}`;
        const response = await fetch(url, {
            method,
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            body: form,
        });
        return this.handleResponse<T>(response);
    }

    /**
     * Make a raw request and return the Response object directly.
     * Used for streaming (SSE) endpoints.
     */
    async requestRaw(
        method: string,
        path: string,
        body?: unknown
    ): Promise<Response> {
        const url = `${this.baseUrl}/api${path}`;
        return fetch(url, {
            method,
            headers: this.getHeaders(),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    }
}
