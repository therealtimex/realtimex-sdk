/**
 * HTTP Client Module - Smart Client with Auth Handling
 */

export class HttpClient {
    private baseUrl: string;
    private appId: string;
    private apiKey?: string;
    private accessToken?: string;

    constructor(baseUrl: string, appId: string, apiKey?: string) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.appId = appId;
        this.apiKey = apiKey;
    }

    private getAppHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.appId) headers['x-app-id'] = this.appId;
        // Use x-api-key for API Key to separate from Bearer Token
        if (this.apiKey) headers['x-api-key'] = this.apiKey;
        return headers;
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken) return this.accessToken;

        try {
            // Self-call to get token using App Auth
            const res = await fetch(`${this.baseUrl}/sdk/auth/token`, {
                headers: this.getAppHeaders()
            });
            const data = await res.json();
            if (res.ok && data.token) {
                this.accessToken = data.token;
                return data.token;
            }
        } catch (e) {
            // Ignore network errors - will fail on actual request if critical
        }
        return '';
    }

    public async fetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
        const url = `${this.baseUrl}${endpoint}`;

        // 1. Get Token (lazy load)
        let token = await this.getAccessToken();

        const makeRequest = (authToken?: string) => {
            const headers: Record<string, string> = {
                ...this.getAppHeaders(),
                ...(options.headers as Record<string, string> || {})
            };

            // Add User Token if available
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            return fetch(url, { ...options, headers });
        }

        let response = await makeRequest(token);

        // 2. Retry on 401 Unauthorized
        if (response.status === 401) {
            console.log('[RealtimeX SDK] 401 Unauthorized, refreshing access token...');

            // Clear cached token
            this.accessToken = undefined;
            const newToken = await this.getAccessToken();

            // Only retry if we got a new/valid token
            if (newToken && newToken !== token) {
                console.log('[RealtimeX SDK] Retrying request with new token');
                response = await makeRequest(newToken);
            }
        }

        return response;
    }
}
