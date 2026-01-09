/**
 * Activities Module - HTTP Proxy to RealtimeX Main App
 * No direct Supabase access - all operations go through Main App
 */

import { Activity } from '../types';

export class ActivitiesModule {
    private baseUrl: string;
    private appId: string;

    constructor(realtimexUrl: string, appId: string) {
        this.baseUrl = realtimexUrl.replace(/\/$/, '');
        this.appId = appId;
    }

    private async request<T>(
        path: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${this.baseUrl}/api${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        // Add app ID header if available
        if (this.appId) {
            headers['X-App-Id'] = this.appId;
        }

        const response = await fetch(url, {
            ...options,
            headers: {
                ...headers,
                ...options.headers,
            },
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `Request failed: ${response.status}`);
        }
        return data;
    }

    /**
     * Insert a new activity
     */
    async insert(rawData: Record<string, unknown>): Promise<Activity> {
        const result = await this.request<{ data: Activity }>('/activities', {
            method: 'POST',
            body: JSON.stringify({ raw_data: rawData }),
        });
        return result.data;
    }

    /**
     * Update an existing activity
     */
    async update(id: string, updates: Partial<Activity>): Promise<Activity> {
        const result = await this.request<{ data: Activity }>(`/activities/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
        });
        return result.data;
    }

    /**
     * Delete an activity
     */
    async delete(id: string): Promise<void> {
        await this.request<{ success: boolean }>(`/activities/${id}`, {
            method: 'DELETE',
        });
    }

    /**
     * Get a single activity by ID
     */
    async get(id: string): Promise<Activity | null> {
        try {
            const result = await this.request<{ data: Activity }>(`/activities/${id}`);
            return result.data;
        } catch (error: any) {
            if (error.message?.includes('not found')) return null;
            throw error;
        }
    }

    /**
     * List activities with optional filters
     */
    async list(options?: { status?: string; limit?: number; offset?: number }): Promise<Activity[]> {
        const params = new URLSearchParams();
        if (options?.status) params.set('status', options.status);
        if (options?.limit) params.set('limit', String(options.limit));
        if (options?.offset) params.set('offset', String(options.offset));

        const query = params.toString() ? `?${params}` : '';
        const result = await this.request<{ data: Activity[] }>(`/activities${query}`);
        return result.data;
    }
}
