/**
 * V1ApiNamespace - Container for all RealtimeX Developer API (v1) modules.
 *
 * Populated by the code generator (Phase 2). Module imports and properties
 * are added automatically when `node scripts/generate-v1-sdk.mjs` is run.
 *
 * Usage:
 *   const sdk = new RealtimeXSDK({ realtimex: { apiKey: 'sk-...' } });
 *   await sdk.v1.workspace.listWorkspaces();
 *   await sdk.v1.admin.listUsers();
 */

import { DeveloperApiClient } from './client';

// --- Generated module imports (added by generate-v1-sdk.mjs) ---
// import { V1AuthModule } from './modules/v1Auth';
// import { V1AdminModule } from './modules/v1Admin';
// import { V1WorkspaceModule } from './modules/v1Workspace';
// import { V1ThreadModule } from './modules/v1Thread';
// import { V1DocumentModule } from './modules/v1Document';
// import { V1SystemModule } from './modules/v1System';
// import { V1UsersModule } from './modules/v1Users';
// import { V1OpenAIModule } from './modules/v1OpenAI';
// import { V1EmbedModule } from './modules/v1Embed';

export class V1ApiNamespace {
    /** @internal Shared HTTP client used by all v1 modules */
    readonly _client: DeveloperApiClient;

    // --- Generated module properties (added by generate-v1-sdk.mjs) ---
    // public auth: V1AuthModule;
    // public admin: V1AdminModule;
    // public workspace: V1WorkspaceModule;
    // public thread: V1ThreadModule;
    // public document: V1DocumentModule;
    // public system: V1SystemModule;
    // public users: V1UsersModule;
    // public openai: V1OpenAIModule;
    // public embed: V1EmbedModule;

    constructor(baseUrl: string, apiKey: string) {
        this._client = new DeveloperApiClient(baseUrl, apiKey);

        // --- Generated module initialisation (added by generate-v1-sdk.mjs) ---
        // this.auth = new V1AuthModule(this._client);
        // this.admin = new V1AdminModule(this._client);
        // this.workspace = new V1WorkspaceModule(this._client);
        // this.thread = new V1ThreadModule(this._client);
        // this.document = new V1DocumentModule(this._client);
        // this.system = new V1SystemModule(this._client);
        // this.users = new V1UsersModule(this._client);
        // this.openai = new V1OpenAIModule(this._client);
        // this.embed = new V1EmbedModule(this._client);
    }
}
