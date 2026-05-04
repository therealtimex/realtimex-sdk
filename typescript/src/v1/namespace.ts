/**
 * V1ApiNamespace - Container for all RealtimeX Developer API (v1) modules.
 *
 * Usage:
 *   const sdk = new RealtimeXSDK({ realtimex: { apiKey: 'sk-...' } });
 *   await sdk.v1?.workspace.listWorkspaces();
 *   await sdk.v1?.admin.listUsers();
 *
 * Regenerate modules: node scripts/generate-v1-sdk.mjs --force
 */

import { DeveloperApiClient } from './client';

// [GENERATED-IMPORTS-START]
import { V1AuthModule } from './modules/v1Auth';
import { V1AdminModule } from './modules/v1Admin';
import { V1DocumentModule } from './modules/v1Document';
import { V1WorkspaceModule } from './modules/v1Workspace';
import { V1SystemModule } from './modules/v1System';
import { V1ThreadModule } from './modules/v1Thread';
import { V1UsersModule } from './modules/v1Users';
import { V1OpenAIModule } from './modules/v1OpenAI';
import { V1EmbedModule } from './modules/v1Embed';
import { V1RuntimeSessionsModule } from './modules/v1RuntimeSessions';
// [GENERATED-IMPORTS-END]

export class V1ApiNamespace {
    /** @internal Shared HTTP client used by all v1 modules */
    readonly _client: DeveloperApiClient;

    // [GENERATED-PROPS-START]
    public auth: V1AuthModule;
    public admin: V1AdminModule;
    public document: V1DocumentModule;
    public workspace: V1WorkspaceModule;
    public system: V1SystemModule;
    public thread: V1ThreadModule;
    public users: V1UsersModule;
    public openai: V1OpenAIModule;
    public embed: V1EmbedModule;
    public runtimeSessions: V1RuntimeSessionsModule;
// [GENERATED-PROPS-END]

    constructor(baseUrl: string, apiKey: string, appId?: string) {
        this._client = new DeveloperApiClient(baseUrl, apiKey, appId);

        // [GENERATED-INIT-START]
        this.auth = new V1AuthModule(this._client);
        this.admin = new V1AdminModule(this._client);
        this.document = new V1DocumentModule(this._client);
        this.workspace = new V1WorkspaceModule(this._client);
        this.system = new V1SystemModule(this._client);
        this.thread = new V1ThreadModule(this._client);
        this.users = new V1UsersModule(this._client);
        this.openai = new V1OpenAIModule(this._client);
        this.embed = new V1EmbedModule(this._client);
        this.runtimeSessions = new V1RuntimeSessionsModule(this._client);
// [GENERATED-INIT-END]
    }
}
