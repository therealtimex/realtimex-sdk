/**
 * Auth Module - Authentication helpers for RealtimeX SDK
 *
 * Provides:
 * - syncSupabaseToken(): Push Supabase JWT to Main App for RLS-aware operations
 * - getAccessToken(): Retrieve the Keycloak access token from Main App (existing endpoint)
 */

export interface AuthTokenResponse {
    token: string;
    hasToken: boolean;
    syncedAt: string | null;
    source: string | null;
}

export interface SyncTokenResponse {
    success: boolean;
    message: string;
    hasToken: boolean;
    syncedAt: string | null;
    source: string | null;
}

export class AuthModule {
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
     * Push a Supabase access token to the Main App.
     * This enables Main App to use the token for:
     * - Realtime subscriptions (bypass RLS)
     * - CRUD operations on rtx_activities (bypass RLS)
     *
     * @param token - Supabase JWT from supabase.auth.signIn()
     *
     * @example
     * ```ts
     * const { data } = await supabase.auth.signInWithPassword({ email, password });
     * await sdk.auth.syncSupabaseToken(data.session.access_token);
     * ```
     */
    public async syncSupabaseToken(token: string): Promise<SyncTokenResponse> {
        if (!token || typeof token !== 'string') {
            throw new Error('Token must be a non-empty string');
        }

        const response = await fetch(`${this.baseUrl}/sdk/auth/sync-supabase-token`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to sync Supabase token');
        }

        return data as SyncTokenResponse;
    }

    /**
     * Retrieve the current Keycloak access token from Main App.
     * This is the existing Token Vending Machine endpoint.
     *
     * @returns The access token info, or null if no token is available.
     */
    public async getAccessToken(): Promise<AuthTokenResponse | null> {
        const response = await fetch(`${this.baseUrl}/sdk/auth/token`, {
            method: 'GET',
            headers: this.getHeaders(),
        });

        const data = await response.json();

        if (response.status === 404) {
            // No token available (user not logged in on Desktop)
            return null;
        }

        if (!response.ok) {
            throw new Error(data.error || 'Failed to get access token');
        }

        return data as AuthTokenResponse;
    }
}
