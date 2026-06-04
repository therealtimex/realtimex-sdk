/**
 * RealtimeX SDK
 *
 * Milestone 1 SDK surface: generated Developer API v1 modules for workspace,
 * thread, and chat.
 */

import { SDKConfig } from './types';
import { V1ApiNamespace } from './v1/namespace';
import { CliApiNamespace } from './cli/namespace';

export class RealtimeXSDK {
    public readonly appId: string;
    public readonly apiKey: string | undefined;
    public readonly realtimexUrl: string;
    public readonly v1: V1ApiNamespace;
    public readonly cli: CliApiNamespace;

    private static DEFAULT_REALTIMEX_URL = 'http://localhost:3001';

    constructor(config: SDKConfig = {}) {
        const envAppId = this.getEnvVar('RTX_APP_ID');
        const envApiKey = this.getEnvVar('RTX_API_KEY');

        this.appId = config.realtimex?.appId || envAppId || '';
        this.apiKey = config.realtimex?.apiKey || envApiKey;
        this.realtimexUrl =
            config.realtimex?.url || RealtimeXSDK.DEFAULT_REALTIMEX_URL;

        this.v1 = new V1ApiNamespace(
            this.realtimexUrl,
            this.apiKey ?? '',
            this.appId || undefined
        );
        this.cli = new CliApiNamespace(
            this.realtimexUrl,
            this.apiKey ?? '',
            this.appId || undefined
        );
    }

    private getEnvVar(name: string): string | undefined {
        if (typeof process !== 'undefined' && process.env) {
            return process.env[name];
        }
        if (typeof window !== 'undefined') {
            return (window as any)[name];
        }
        return undefined;
    }
}

export * from './types';
export { CliApiClient } from './cli/client';
export { CliApiNamespace } from './cli/namespace';
export { V1ApiNamespace } from './v1/namespace';
export { DeveloperApiClient } from './v1/client';
export {
    DeveloperApiError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
    ServerError,
} from './v1/errors';
