/**
 * RealtimeX Local App SDK
 * 
 * SDK for building Local Apps that integrate with RealtimeX
 * All operations go through RealtimeX Main App proxy
 */

import { SDKConfig } from './types';
import { ActivitiesModule } from './modules/activities';
import { WebhookModule } from './modules/webhook';
import { ApiModule } from './modules/api';

export class RealtimeXSDK {
    public activities: ActivitiesModule;
    public webhook: WebhookModule;
    public api: ApiModule;
    public readonly appId: string;
    public readonly appName: string | undefined;

    private static DEFAULT_REALTIMEX_URL = 'http://localhost:3001';

    constructor(config: SDKConfig = {}) {
        // Auto-detect app ID from environment (injected by Main App)
        const envAppId = this.getEnvVar('RTX_APP_ID');
        const envAppName = this.getEnvVar('RTX_APP_NAME');

        this.appId = config.realtimex?.appId || envAppId || '';
        this.appName = config.realtimex?.appName || envAppName;

        // Default to localhost:3001
        const realtimexUrl = config.realtimex?.url || RealtimeXSDK.DEFAULT_REALTIMEX_URL;

        // Initialize modules
        this.activities = new ActivitiesModule(realtimexUrl, this.appId);
        this.webhook = new WebhookModule(realtimexUrl, this.appName, this.appId);
        this.api = new ApiModule(realtimexUrl);
    }

    /**
     * Get environment variable (works in Node.js and browser)
     */
    private getEnvVar(name: string): string | undefined {
        // Node.js environment
        if (typeof process !== 'undefined' && process.env) {
            return process.env[name];
        }
        // Browser with injected globals
        if (typeof window !== 'undefined') {
            return (window as any)[name];
        }
        return undefined;
    }
}

// Re-export types
export * from './types';

// Re-export modules for advanced usage
export { ActivitiesModule } from './modules/activities';
export { WebhookModule } from './modules/webhook';
export { ApiModule } from './modules/api';
