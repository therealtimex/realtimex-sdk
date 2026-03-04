export interface AuthProvider {
    buildHeaders(baseHeaders?: Record<string, string>): Record<string, string>;
}

export interface StaticAuthProviderOptions {
    appId?: string;
    appName?: string;
    apiKey?: string;
}

export class StaticAuthProvider implements AuthProvider {
    private readonly appId?: string;
    private readonly appName?: string;
    private readonly apiKey?: string;

    constructor(options: StaticAuthProviderOptions = {}) {
        this.appId = options.appId;
        this.appName = options.appName;
        this.apiKey = options.apiKey;
    }

    buildHeaders(baseHeaders: Record<string, string> = {}): Record<string, string> {
        const headers = { ...baseHeaders };

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
}
