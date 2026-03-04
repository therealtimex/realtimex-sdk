/**
 * Database Module - Retrieve Supabase config from RealtimeX Main App
 *
 * Allows Local Apps to fetch their database configuration (URL, anonKey, mode)
 * without hardcoding them.
 */

export interface DatabaseConfig {
    url: string;
    anonKey: string;
    mode: 'compatible' | 'custom';
    tables: string[];
    max_concurrent_tasks: number;
}

export class DatabaseModule {
    private baseUrl: string;
    private appId: string;
    private apiKey?: string;

    constructor(realtimexUrl: string, appId: string, apiKey?: string) {
        this.baseUrl = realtimexUrl.replace(/\/$/, '');
        this.appId = appId;
        this.apiKey = apiKey;
    }

    private getHeaders(): Record<string, string> {
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
     * Get the Supabase database configuration for this app.
     * Returns URL, anonKey, mode, and tables.
     *
     * @example
     * ```ts
     * const config = await sdk.database.getConfig();
     * const supabase = createClient(config.url, config.anonKey);
     * ```
     */
    public async getConfig(): Promise<DatabaseConfig> {
        const response = await fetch(`${this.baseUrl}/sdk/database/config`, {
            method: 'GET',
            headers: this.getHeaders(),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to get database config');
        }

        return data.config as DatabaseConfig;
    }
}
