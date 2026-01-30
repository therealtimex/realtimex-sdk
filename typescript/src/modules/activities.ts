/**
 * Activities Module - HTTP Proxy to RealtimeX Main App
 * No direct Supabase access - all operations go through Main App
 */

import { Activity } from '../types';
import { PermissionDeniedError } from './api';

export class ActivitiesModule {
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

    private async request<T>(
        path: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        if (this.appId) {
            // Production mode: use x-app-id
            headers['x-app-id'] = this.appId;
        }

        const response = await fetch(url, {
            ...options,
            headers: {
                ...headers,
                ...options.headers,
            },
        });

        const data = await response.json();

        // Handle permission errors
        if (response.status === 403) {
            const errorCode = data.error;
            const permission = data.permission;
            const message = data.message;

            if (errorCode === 'PERMISSION_REQUIRED' && permission) {
                // Try to get permission from user
                const granted = await this.requestPermission(permission);

                if (granted) {
                    // Retry the original request
                    return this.request<T>(path, options);
                } else {
                    throw new PermissionDeniedError(permission, message);
                }
            }

            if (errorCode === 'PERMISSION_DENIED') {
                throw new PermissionDeniedError(permission, message);
            }
        }

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
