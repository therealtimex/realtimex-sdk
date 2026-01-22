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
import { TaskModule } from './modules/task';
import { PortModule } from './modules/port';
import { LLMModule } from './modules/llm';

export class RealtimeXSDK {
    public activities: ActivitiesModule;
    public webhook: WebhookModule;
    public api: ApiModule;
    public task: TaskModule;
    public port: PortModule;
    public llm: LLMModule;
    public readonly appId: string;
    public readonly appName: string | undefined;
    private readonly realtimexUrl: string;
    private readonly permissions: string[];

    private static DEFAULT_REALTIMEX_URL = 'http://localhost:3001';

    constructor(config: SDKConfig = {}) {
        // Auto-detect app ID from environment (injected by Main App)
        const envAppId = this.getEnvVar('RTX_APP_ID');
        const envAppName = this.getEnvVar('RTX_APP_NAME');

        this.appId = config.realtimex?.appId || envAppId || '';
        this.appName = config.realtimex?.appName || envAppName;
        this.permissions = config.permissions || [];

        // Default to localhost:3001
        this.realtimexUrl = config.realtimex?.url || RealtimeXSDK.DEFAULT_REALTIMEX_URL;

        // Initialize modules
        this.activities = new ActivitiesModule(this.realtimexUrl, this.appId, this.appName);
        this.webhook = new WebhookModule(this.realtimexUrl, this.appName, this.appId);
        this.api = new ApiModule(this.realtimexUrl, this.appId, this.appName);
        this.task = new TaskModule(this.realtimexUrl, this.appName, this.appId);
        this.port = new PortModule(config.defaultPort);
        this.llm = new LLMModule(this.realtimexUrl, this.appId);

        // Auto-register with declared permissions
        if (this.permissions.length > 0) {
            this.register().catch(err => {
                console.error('[RealtimeX SDK] Auto-registration failed:', err.message);
            });
        }
    }

    /**
     * Register app with RealtimeX hub and request declared permissions upfront.
     * This is called automatically if permissions are provided in constructor.
     */
    public async register(permissions?: string[]) {
        const perms = permissions || this.permissions;
        if (perms.length === 0) return;

        try {
            const response = await fetch(`${this.realtimexUrl.replace(/\/$/, '')}/sdk/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    app_id: this.appId,
                    app_name: this.appName,
                    permissions: perms,
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Registration failed');
            }

            console.log(`[RealtimeX SDK] App registered successfully (${data.message})`);
        } catch (error: any) {
            throw new Error(`Failed to register app: ${error.message}`);
        }
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
export { ApiModule, PermissionDeniedError, PermissionRequiredError } from './modules/api';
export { TaskModule } from './modules/task';
export { PortModule } from './modules/port';
export {
    LLMModule,
    VectorStore,
    LLMPermissionError,
    LLMProviderError,
    // Types
    type ChatMessage,
    type ChatOptions,
    type ChatResponse,
    type StreamChunk,
    type EmbedOptions,
    type EmbedResponse,
    type Provider,
    type ProvidersResponse,
    type VectorRecord,
    type VectorUpsertOptions,
    type VectorUpsertResponse,
    type VectorQueryOptions,
    type VectorQueryResult,
    type VectorQueryResponse,
    type VectorDeleteOptions,
    type VectorDeleteResponse,
} from './modules/llm';

